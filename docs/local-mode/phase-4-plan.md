# Phase 4 — Prompt split and the real run

**Parent:** [00-overview.md](00-overview.md) (D5, D7, D9, D12, D14, A4, A7,
A8). **Status:** in progress.

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

- no shell metacharacter that chains, redirects or substitutes (`;`, `&`,
  `|`, `<`, `>`, a backtick, `$(`, a newline);
- the program is one of `git`, `rg`, `ls`, `cat`, `head`, `tail`, `wc`;
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
`rg --pre sh .`.

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
