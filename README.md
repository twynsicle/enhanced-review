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
er review 42
```

Pull request #42, read through `gh`. The review happens in a temporary
worktree of the PR's head, so your own working tree is never touched and
never has to be clean.

```bash
er review --staged
```

What you have staged, against `HEAD` — a review before the commit.

### What it costs, and how long

The model run is the only stage that costs anything or needs the network.
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
`raw.txt` (what the model said), `events.jsonl` (what it did, what it cost,
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

`--model`, `--max-turns` and `--timeout` override the defaults
(`claude-sonnet-5`, 60 turns, 15 minutes). `er review --help` lists
everything.

### Diagrams

The model may attach a diagram to the review and to any chapter: an
architecture map, a state machine, a before/after of one procedure, or a
sequence. It does not write mermaid. It writes a small JSON schema
(`src/domain/review/diagram.ts`) in which every node and edge says what the
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
  **Vite 8**, Tabler icons, Zustand for persisted client preferences, **Zod 4**
  at every boundary. This is the reader `er review` renders its report into.
- **oxlint**, Prettier, **Vitest 4**.

### Repo layout

| Path              | What                                                          |
| ----------------- | ------------------------------------------------------------- |
| `src/config/`     | Host environment for the subprocesses `er` spawns             |
| `src/common/`     | Small shared helpers                                          |
| `src/domain/`     | The review model, prompt and parser. Shared with the browser  |
| `src/web/`        | The report's React code: reader components, theme, the viewer |
| `src/cli/`        | `er`, the local review CLI, and its stages                    |
| `src/guardrails/` | Tests that read the repo and enforce its conventions          |

`AGENTS.md` has the tree, the layering rules the guardrails enforce, and the
`*.server.ts` convention that keeps Node-only code out of the browser
bundle; `.claude/rules/` holds the file-by-file detail for each area.

### Scripts

| Script                            | What                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`               | `tsc --noEmit`                                                      |
| `npm test` / `npm run test:watch` | Vitest: unit + web + guardrails                                     |
| `npm run lint` / `format`         | oxlint / Prettier                                                   |
| `npm run check`                   | **The gate**: typecheck + viewer:build + test + lint + format:check |
| `npm run viewer:dev`              | The local report's reader, against sample data                      |
| `npm run viewer:build`            | The local report shell `er review` renders into                     |

### Testing

`npm run check` is the gate. It never calls the Anthropic API: the tests stop
at the Agent SDK boundary and use `--stub`.
