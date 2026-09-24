# enhanced-review

AI code review: a chaptered narrative with an overview, a risk assessment,
insights, diagrams of what changed, inline diffs you can open beside the prose,
and — where the code cannot settle it — a question or two put back to you.
It runs as `er`, one command inside the repository you want reviewed. The
hosted web app was removed; it is kept at the git tag `hosted-app-final`.

- **Working on the code** — [AGENTS.md](AGENTS.md) is the map of the tree:
  layering rules and module conventions. The per-area detail it points to lives in
  [.claude/rules/](.claude/rules/).
- **What is not built yet** — the `Backlog` of the Linear team
  [enhanced-reviews](https://linear.app/lemon-dev/team/ER/backlog)

## Local mode

`er review` runs the whole review on your laptop: it gathers the change with
`git` and `gh`, runs the Claude Agent SDK as **you**, and writes one
`review.html`. No server, no
database, no GitHub App — which is the point, because getting an app installed
in an organisation can take months.

The report is a single file: every script, style and font is inlined, so there
is nothing beside it to keep or to send. The diff editor is the exception — it
is fetched from a CDN when a diff is opened, which keeps the file small enough
to email. Reading the review needs no network; reading a diff does.

### What reaches the network

`er` has no server of its own, opens no port and uploads nothing. What it
reaches, and why:

- **GitHub**, through your own `git` and `gh`: fetching the branch or the pull
  request under review, and reading a pull request's title, description and
  base.
- **Anthropic**, through the Claude Agent SDK, which runs as you with your own
  sign-in: the prompt, and whatever the agent reads from the repository while
  it reviews. The agent's tools are read-only — Read, Glob, Grep, and Bash
  limited to read-only git history (`src/cli/bash-gate.ts`). With
  `--find-copy-sources`, a second, shorter run with the same Bash gate and no
  other tool: the list of new files, and what it reads of them and their
  neighbours through git.
- **cdn.jsdelivr.net**, from the report in your browser: the Monaco diff
  editor, pinned to the version in `package.json`, fetched when a diff is
  first shown (`src/report/reader/monaco-cdn.ts`). Nothing about the review is
  sent with that request.
- **npm**, once, when you install `er`.

### Prerequisites

| Tool                                          | Version | Why                                                                                      |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Node                                          | >= 24   | Type stripping runs `er` directly — no build step.                                       |
| npm                                           | >= 10   | Bundled with Node; `npm link` puts `er` on PATH.                                         |
| Git                                           | recent  | `er` shells out to `git` to gather the change and, for a PR review, to add a worktree.   |
| `gh`                                          | recent  | Reads pull request metadata — `er review 42` and a branch review with an open PR.        |
| a Claude Code sign-in, or `ANTHROPIC_API_KEY` | —       | `er` runs the Agent SDK as you; see [Authentication is yours](#authentication-is-yours). |

Windows and macOS are both supported — everything OS-specific lives behind
`src/cli/platform.ts`.

### Install

```bash
npm install
```

```bash
npm link
```

That puts `er` on your PATH, pointing at this working tree: pull a change and
it takes effect, with no rebuild. Then run it from inside **any** repository
you want reviewed, not from this one.

```bash
er review --help
```

confirms it is installed and lists the options below.

### Authentication is yours

`er` never reads or stores a credential. It starts the Agent SDK as a
subprocess, which inherits your environment and signs in the same way your
own `claude` does — either an `ANTHROPIC_API_KEY` in the environment, or the
session `claude` itself wrote when you signed in.

A run that ends in `Not logged in` means that session has expired, however
recently you used Claude elsewhere. Fix it where you would normally:

```bash
claude
```

Then `/login`, and run `er review` again.

### The three targets

```bash
er review
```

The current branch, against its pull request's base if one is open, and the
default branch otherwise. It works before a PR exists, which is how you check work an agent wrote for you.

```bash
er review --base lemon/trickle/parent-branch
```

Compares against `<ref>` instead of the PR's base or the default branch.
Reach for this when the current branch is stacked on another branch rather
than on `main` — without it, "against the default branch" pulls in every
commit from every branch underneath it too, which stops being a review of
just your branch once the stack gets more than one deep.

```bash
er review 42
```

Pull request #42, read through `gh`. The review happens in a temporary
worktree of the PR's head, so your own working tree is never touched and
never has to be clean.

```bash
er review --staged
```

What you have staged, against `HEAD` — a review before the commit.

### Every option

| Flag                         | Applies to   | What it does                                                                                   |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `--base <ref>`               | branch, PR   | compare against `<ref>` instead of the PR's base or the default branch                         |
| `--model <name>`             | every review | review with `<name>` (default: `claude-sonnet-5[1m]`)                                          |
| `--max-turns <n>`            | every review | let the model take at most `<n>` turns (default: `120`)                                        |
| `--timeout <minutes>`        | every review | give up on the model run after `<minutes>` (default: `15`)                                     |
| `--instructions <text>`      | every review | add your own guidance to the prompt — what to focus on, what to explain — see below            |
| `--instructions-file <path>` | every review | the same, read from a file, for anything long or multi-line                                    |
| `--stub`                     | every review | write a mechanical review instead of running a model — see below                               |
| `--from <stage>`             | every review | resume the newest run for this target at `prompt`, `run`, `parse` or `render` — see below      |
| `--no-open`                  | every review | write the report without opening it                                                            |
| `--keep-worktree`            | PR reviews   | leave the PR's temporary worktree in place instead of removing it                              |
| `--allow-large`              | every review | run the model on more than 300 reviewed files, which `er` otherwise refuses (it warns past 50) |
| `--find-copy-sources`        | every review | ask a small model which file each new file was copied from, when git cannot tell — see below   |
| `-h`, `--help`               | —            | show usage and exit                                                                            |
| `-v`, `--version`            | —            | show the installed version and exit                                                            |

`--staged` (a target, not an option) and `--base` cannot be combined: the
staged tree has no branch to compare against but `HEAD`.

`--instructions` goes straight into the model's prompt, as guidance from the
person who will read the review, and steers where it looks hardest and what it
explains; it cannot change what a review is made of. For example:

```bash
er review 42 --instructions "Focus on the retry logic and whether it can double-charge. Keep the UI chapters brief."
```

Instructions that start with a dash, such as a bullet list, need the `=` form:
`--instructions="- check the retry path"`. For anything longer, write it to a
file and pass `--instructions-file`, which reads UTF-8 or the UTF-16 Windows
PowerShell writes. The text is part of the prompt, so it is paid for on every
turn; the prompt stage line counts it in.

The instructions are written into `prompt.md`, so `--from run` reuses them;
they cannot be given with `--from run`, `parse` or `render`, which write no
new prompt. `--from prompt` writes the prompt again from that command's flags,
so repeat the instructions there to keep them.

#### Copied files

A new file cloned from an existing one — a handler modelled on its sibling, a
test copied from the one beside it — is shown as a diff against the file it was
copied from, with "Copied from `<path>` · N% similar" above it, so the review
reads what changed from the template rather than an all-green new file. Git
finds these on its own when the copy is at least 50% similar to its source;
that needs no flag.

Below 50%, git cannot tell a reworked clone from a new file.
`--find-copy-sources` asks a model to name the source for each new file git left
unpaired:

```bash
er review --find-copy-sources
```

It is a short run of Claude Haiku before the review starts, reading both sides
with read-only git commands only — no working tree, no edits. Git then scores
and diffs each pair it names, exactly as it would one it had found itself, so
the model decides only which file, never what the diff says. It adds a line to
the output, such as `sources  3 new files checked, 1 source found, $0.03`, and
typically well under a minute; with no unpaired new files it does not run at
all.

A source git finds no line in common with is printed as a warning, and that file
is reviewed as new. An answer naming a file it was not asked about, or a source
that did not exist at the base, fails the run instead: `er` would rather stop
than show a diff against the wrong file. The flag cannot be combined with
`--stub`, which runs no model, or with `--from`, which reuses the files already
gathered.

### What it costs, and how long

The model run is the only stage that costs anything.
Measured on this repository, an 88-file, 138-hunk change:

|           |                                         |
| --------- | --------------------------------------- |
| Turns     | 27–32                                   |
| Wall time | 5–8 minutes                             |
| Cost      | **$1.87–$2.98** of your own allowance   |
| Tokens in | ~1.1M, of which 93% was read from cache |
| Report    | 2.4 MB of HTML                          |

That is what an agentic review costs: it pays for its whole context on every
turn, so the bill tracks the number of turns more than the size of the diff.
The run line reports all of it as it finishes, cache share included.
`--find-copy-sources` adds a few cents on top, reported on its own line.

Two ways to spend nothing while working on the tool itself:

```bash
er review --stub
```

A mechanical review with one chapter per file — no model, no cost, and the
right way to iterate on the reader.

```bash
er review --from parse
```

Re-runs only the later stages against the answer the last run already saved.
Every stage writes its input and output to the run folder, so `--from prompt`,
`run`, `parse` or `render` picks up the newest run for that target. If a
review fails to parse, its text is still on disk and this is how you rebuild
the report without paying twice.

### Where it writes

`er-reviews/<target>/<timestamp>/` inside the repository under review,
ignored by git automatically. The report is `review.html`, and it opens when
it is written unless you pass `--no-open`. Beside it sit the stage files:
`context.json` (what changed), `prompt.md` and `system.md` (what was asked),
`raw.txt` (what the model said), `copy-sources.txt` (the copy-source run's
answer, with `--find-copy-sources`), `events.jsonl` (what it did, what it cost,
any command the read-only gate refused and any answer it was asked to write
again), `review.json` (the parsed review) and `findings.json` (what validating
it turned up). A run folder is a complete record; delete the tree whenever you
like.

`er review` exits 0 for a clean review, 2 for one that was written but carries
warnings — each of them printed as it finishes — and 1 when there is no review
to open.

### What the model may do

It gets `Read`, `Glob` and `Grep`, and `Bash` for read-only history —
`git log`, `git show`, `git blame`, `git diff`, and `rg`/`grep`/`ls`/`cat`
piped together. Every command is checked before it runs, and anything that
could write, or reach a program not on the list, is refused with a message
saying what it may run instead. Refusals are recorded in `events.jsonl` and
reported as one warning when the review finishes; a review is never failed by
one.

`--model`, `--max-turns` and `--timeout` override the defaults it runs with —
see "Every option" above.

### Diagrams

The model may attach a diagram to the review and to any chapter: an
architecture map, a state machine, a before/after of one procedure, or a
sequence. It does not write mermaid. It writes a small JSON schema
(`src/review/diagram.ts`) in which every node and edge says what the
pull request did to it — added, removed, modified or unchanged — because a
review diagram describes a change, not a system. A code node can point at a
file and hunks from the diff, and the parser drops any path or hunk the diff
does not contain, so a diagram can only link to code that is really there.
An invalid diagram is dropped on its own and never fails the review.

The reader lays diagrams out with dagre and draws them as SVG,
in the design system's tokens and type scale. They render at full size and
scroll sideways rather than shrinking text, and every diagram opens in a
full-screen view with pan and zoom.

### Known gaps

Local mode's model run is not covered by automated tests: tests stop at the
Agent SDK boundary and use `--stub`, so the real SDK call is exercised by hand
rather than CI.

## Development

### Tech stack

- **Node 24** (Volta-pinned). `er` is TypeScript that Node runs directly via
  type stripping — no build step for `src/cli/`.
- **React 19** + **Mantine 9** (theme-driven, minimal per-component CSS) on
  **Vite 8**, Tabler icons, Zustand for persisted reader preferences, **Zod 4**
  at every boundary. This is the report `er review` renders into: one
  client-rendered page, no router, no server.
- **oxlint**, Prettier, **Vitest 4**.

### Repo layout

| Path              | What                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `src/cli/`        | `er`, the local review CLI, and its stages. Node only               |
| `src/review/`     | What a review is: schemas, validation, prompt, parser. Read by both |
| `src/report/`     | The report: the reader, its chrome, theme and stores. Browser only  |
| `src/guardrails/` | Tests that read the repo and enforce its conventions                |

`AGENTS.md` has the tree and the layering rules the guardrails enforce;
`.claude/rules/` holds the file-by-file detail for each area.

### Scripts

| Script                            | What                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`               | `tsc --noEmit`                                                      |
| `npm test` / `npm run test:watch` | Vitest: unit + report + guardrails                                  |
| `npm run lint` / `format`         | oxlint / Prettier                                                   |
| `npm run check`                   | **The gate**: typecheck + report:build + test + lint + format:check |
| `npm run report:dev`              | The report, against sample data                                     |
| `npm run report:build`            | The report shell `er review` renders into                           |

### Testing

`npm run check` is the gate. It never calls the Anthropic API: the tests stop
at the Agent SDK boundary and use `--stub`.
