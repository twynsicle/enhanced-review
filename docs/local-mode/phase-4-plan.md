# Phase 4 — Prompt split and the real run

**Parent:** [00-overview.md](00-overview.md) (D5, D7, D9, D12, D14, A4, A7,
A8). **Status:** commits 1–5 landed (see Result).

This phase makes `er review` run Claude. The stages either side of it are
done: gather writes the change into a run folder, prompt writes `system.md`
and `prompt.md`, and parse and render turn raw model text into the report.
What is missing is the middle: an Agent SDK run in the review's working
directory, streaming its progress to the terminal and its text to `raw.txt`.

Two pieces of tidying come with it, both from the locked decisions. The SDK
message loop is shared with the server executor instead of written twice
(A7), and the review instructions move into a module both delivery paths
import, with the server's assembled prompt byte-identical before and after
(D14).

## Shape

```
src/cli/
  claude-run.ts    the run stage: the SDK in the working directory → raw.txt + events.jsonl
  progress.ts      the live line: what the agent is reading, chapters as they arrive
src/domain/review/
  executor/sdk-loop.ts             the message loop, logger-free, shared by both executors
  executor/claude-executor.server.ts  keeps the server's own options; loop imported
  prompt/instructions.ts           the review instructions + one boundary paragraph per path
  prompt/narrative-prompt.ts       the server's delivery section, text unchanged
```

## The run stage

- **Input is the run folder**, not the context: `system.md` and `prompt.md`
  as the prompt stage wrote them. So `--from run` re-runs the model against a
  hand-edited prompt, which is how prompt changes get tried.
- **Working directory** is what Phase 3 already picks: a worktree of the PR's
  head, or the repository itself.
- **Options.** `settingSources: ['user', 'project', 'local']`, so the
  reviewed repo's `CLAUDE.md` and settings load as they would in a normal
  session (D5); `Read`, `Glob` and `Grep` pre-approved, `Bash` gated (below);
  `maxTurns` and the model from flags; an `AbortController` driven by the
  timeout and by SIGINT. The CLI reads no `process.env` itself (A4) — the SDK subprocess
  inherits the engineer's environment, which is where their credentials are.
- **Output.** `raw.txt` is written as text arrives, so a run that dies still
  leaves something for `--from parse`. `events.jsonl` gets one line per SDK
  message (type, subtype, tool name and its path or pattern, token counts) —
  no message content, so it stays small and readable.
- **Progress (D12).** A live line under the stage: elapsed time, the file the
  agent is reading, and chapter titles as they stream out of the JSON. The
  stage line that replaces it records turns, wall time and cost.
- **Failure.** Parse-first, as the server executor already does: a complete
  narrative followed by `error_max_turns` is still a review. Otherwise the
  error names the fix — `--max-turns`, `--timeout`, or `--from parse` after
  editing `raw.txt`.

## Read-only Bash

A local review gets `Bash` as well as the hosted three, so it can ask how
code got this way: `git log`, `git blame`, `git show`, `rg`. This overrides
A7, which took the hosted tool set as read; that set is shaped by running
other people's repositories on a server, which is not the situation on the
engineer's own laptop.

Nothing else may run. `Bash` is left out of `allowedTools`, so every command
reaches a `canUseTool` callback that allows one only when all of this holds:

- the line splits at `|`, `||` and `&&`, and **every** command in it has to
  pass on its own; nothing else that could reach a second program survives
  (`;`, a lone `&`, a subshell, a backtick, `$(`, `${`, a newline, or any
  redirection but `2>/dev/null`);
- the program is one of `cd`, `git`, `rg`, `grep`, `ls`, `cat`, `head`,
  `tail`, `wc`;
- for `git`, the subcommand is on a read-only list (`log`, `show`, `diff`,
  `blame`, `status`, `rev-parse`, `ls-files`, `ls-tree`, `cat-file`,
  `describe`, `shortlog`, `merge-base`, `name-rev`) and there is no `-c` or
  `--output` argument;
- no argument that makes a listed program run another one (`rg --pre`,
  `--hostname-bin`).

A denial returns a message saying what the agent may run instead, which is a
normal tool result rather than a failed review. The gate is a pure function
with its own tests, including the commands it must refuse: `git push`,
`git config user.email x`, `rm -rf .`, `cat x > y`, `git log; rm x`,
`rg --pre sh .`, `cd /tmp && rm -rf .`, `ls | xargs rm`.

Splitting a chain rather than banning one was commit 5's correction: the
first real review asked four Bash questions and every one of them was
refused, because the model reaches for history the way a person does — from
a directory it names itself, piped through `head` so the answer stays
short. Each of those is still only reads, and a chain is no more dangerous
than the worst command in it, which is exactly what the gate now measures.
A refusal also costs a turn, so each one is a `denied` event in
`events.jsonl` and the run stage says how many there were.

## Shared SDK loop (A7)

`runSdkQuery` takes the query function, the prompt, the options and
callbacks for text and events, and returns the raw text plus the result
message. It carries today's semantics exactly: abort wins over parse errors,
an `onChunk` throw aborts the query, and a non-success result is reported
only when the text does not parse. It imports no logger and no config, so
`cli-imports` stays green.

The server executor keeps everything that makes it a server: the host-env
allowlist, `settingSources: []`, the clone-only sandbox, its logging. Its
existing tests must pass untouched — that is the check that the extraction
changed nothing.

## Prompt split (D14)

`instructions.ts` holds `NARRATIVE_SYSTEM_PROMPT` and the boundary paragraph
for each path: the server's "freshly cloned working tree, the diff is your
primary input", and a local one saying the working directory is the
engineer's repository, the hunk files are the source of truth for what
changed, and everything else is context to read as needed.

The server's prompt text does not change. A fixture of the fully assembled
server system + user prompt is committed before the split, and a test
compares the assembled prompt against it afterwards.

## Flags (A8)

| Flag              | Default           | Why                                              |
| ----------------- | ----------------- | ------------------------------------------------ |
| `--model <name>`  | `claude-sonnet-5` | Trying a different model on the same prompt      |
| `--max-turns <n>` | set in commit 5   | A 60-file review needs more than the server's 30 |
| `--timeout <min>` | 15                | A wedged run has to end by itself                |

## Commits

1. **`er review` runs Claude.** `claude-run.ts` with its own minimal loop,
   the Bash gate, the three flags, `raw.txt`, `events.jsonl` and a plain
   progress line.
   Proves the phase's risk: SDK auth from a script, the reviewed repo's
   settings loaded, tool events streamed. Updates `.claude/rules/cli.md`.
   Fallback if the SDK cannot be driven this way: spawn the `claude` CLI and
   read its stream-json output.
   - **Result:** the SDK runs from `er`, in the review's working directory,
     with the reviewed repository's own configuration: `events.jsonl` shows
     its hooks firing before `init`. The fallback is not needed. What could
     not be checked from an agent session is authentication — the SDK
     subprocess there has no credentials of its own and comes back "Not
     logged in", so the first real review has to be run from the engineer's
     own terminal. Two things came out of that failure: a result can carry
     `is_error` while its subtype still says `success` (that now counts as an
     incomplete run), and an error that mentions signing in now says how.
2. **The shared loop.** Extract `sdk-loop.ts`, move both executors onto it,
   delete the duplicate.
3. **The prompt split**, with the server snapshot fixture and its test.
4. **Progress and failures.** The live line, chapter titles, timeout and
   interrupt handling, the error wording.
5. **Measurement and defaults.** Real runs on a specimen PR and one
   roughly 60-file PR; `maxTurns` default set from what they need; turns,
   time, cost and report size recorded here.
   - **Result:** measured against this branch (below). The defaults stand at
     60 turns and 15 minutes, both about double what the largest run needed.
     The measurement also found the Bash gate refusing every command the
     model asked, which is what changed the gate and added the `denied`
     event.

## Verification

- `npm run check` green after every commit, with the server executor's own
  tests unchanged.
- The assembled server prompt matches the fixture taken before the split.
- Real reviews end to end, from the linked `er`: a specimen PR, a branch,
  and one roughly 60-file PR. Each produces a report that renders, whose
  chapters cite hunk ids from the catalog.
- The agent does not narrate files outside the hunk table (the working-tree
  risk in the overview's §6), checked by reading one branch review run in a
  dirty tree.
- Ctrl+C during a real PR run leaves no worktree and no temp folder. This is
  Phase 3's deferred manual check: a real run lasts long enough to hit.
- `--from run` after editing `prompt.md` re-runs only the model.
- `--from parse` on a truncated `raw.txt` still reports a useful error.
- A real run's `events.jsonl` shows `Bash` used for history, and no denial of
  a command that should have been allowed.

## Result

**Status: commits 1–5 landed.** The verification that needs a real,
paid run is marked below; everything else is done.

The measurement is one review of this branch, run from the engineer's own
terminal against `feat/er-13-local-review-cli` (`639b79d..22511ed`):

|        |                                                                   |
| ------ | ----------------------------------------------------------------- |
| Change | 88 files, 138 hunks, ~8.7k tokens of prompt                       |
| Run    | 32 turns, ~11.4k tokens of review, **$2.98**, **7m 36s**          |
| Tools  | 27 `Read`, 4 `Bash` — all four `Bash` calls refused               |
| Review | 12 chapters, 135 of 138 hunks cited, 6 chapter diagrams, risk 4/5 |
| Report | `review.html`, 2.4 MB, rendered in 39 ms                          |

Where that money went is arithmetic, not mystery: the system prompt and
`prompt.md` are ~12k tokens, the 27 `Read` calls added ~40k more, and an
agentic run pays for its whole context on **every** turn — so 32 turns of a
context growing to ~67k tokens is on the order of 1.2M input tokens. Whether
that was mostly cache reads or mostly fresh input decides whether a review
costs cents or dollars, and this run could not say, because the loop kept
only `total_cost_usd`. It now keeps `modelUsage` as well: the result event
records input, output and cache tokens, and the run stage prints the tokens
that went in and the share of them served from cache. The next real run
answers the question. (The same change makes a run that hits `--max-turns`
report its cost instead of `null`; it spent the money either way.)

What that says about the defaults: 60 turns and 15 minutes leave a change
about twice this size room to finish, and a run that does hit either keeps
what it wrote. The cost is worth stating plainly in the README — a large
review is a few dollars of the engineer's own allowance.

Two things the numbers settled, both fixed in commit 5:

- **The gate was too tight.** Four Bash calls, four refusals, no successful
  one. The model asked `cd "<repo>" && git diff <range> -- <paths> | head -150`
  — a read, in the form a person would type. The gate now splits a chain and
  checks each part, so that line is allowed and `ls | xargs rm` still is not,
  and `LOCAL_WORKING_TREE` tells the model Bash already starts in the working
  directory so the `cd` is unnecessary.
- **Refusals were invisible.** `events.jsonl` recorded the attempt but not the
  outcome, so a review could quietly lose turns to a gate nobody could see.
  Each refusal is now a `denied` event, and the run stage prints how many.

Verified: the assembled server prompt matches the fixture; the review's
chapters cite catalog hunk ids and name no file outside the change
(checked against `context.json`); `--from parse` and `--from run` resume
from the run folder; the gate's four real commands are now allowed, and
`npm run check` is green.

**Still owed, and needing a paid run each:** a reading of the cache share on
the next run, which decides whether cost work is needed at all; a review of a specimen PR and
of a roughly 60-file PR; a run that shows `Bash` actually used for history
with no denials; and Phase 3's deferred Ctrl+C check, which a 7-minute run
now makes easy to hit.
