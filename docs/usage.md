# Using er

Everything about running `er` once you have decided to: what it needs, the
three kinds of change it reviews, every option, what it costs and what it
leaves behind. The [README](../README.md) is the short version.

## Prerequisites

| Tool                                          | Version | Why                                                                                      |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Node                                          | >= 24   | Type stripping runs `er` directly — no build step.                                       |
| npm                                           | >= 10   | Bundled with Node; `npm link` puts `er` on PATH.                                         |
| Git                                           | recent  | `er` shells out to `git` to gather the change and, for a PR review, to add a worktree.   |
| `gh`                                          | recent  | Reads pull request metadata — `er review 42` and a branch review with an open PR.        |
| a Claude Code sign-in, or `ANTHROPIC_API_KEY` | —       | `er` runs the Agent SDK as you; see [Authentication is yours](#authentication-is-yours). |

Windows and macOS are both supported — everything OS-specific lives behind
`src/cli/platform.ts`.

## Install

```bash
git clone https://github.com/twynsicle/enhanced-review.git
cd enhanced-review
npm install
npm link
```

`npm link` puts `er` on your PATH, pointing at this working tree: pull a
change and it takes effect, with no rebuild. Then run it from inside **any**
repository you want reviewed, not from this one.

```bash
er review --help
```

confirms it is installed and lists the options below.

## Authentication is yours

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

## The three targets

```bash
er review
```

The current branch, against its pull request's base if one is open, and the
default branch otherwise. It works before a PR exists, which is how you check
work an agent wrote for you.

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

## Every option

| Flag                         | Applies to   | What it does                                                                                   |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `--base <ref>`               | branch, PR   | compare against `<ref>` instead of the PR's base or the default branch                         |
| `--model <name>`             | every review | review with `<name>` (default: `claude-sonnet-5[1m]`)                                          |
| `--max-turns <n>`            | every review | let the model take at most `<n>` turns (default: `120`)                                        |
| `--timeout <minutes>`        | every review | give up on the model run after `<minutes>` (default: `15`)                                     |
| `--instructions <text>`      | every review | add your own guidance to the prompt — what to focus on, what to explain — see below            |
| `--instructions-file <path>` | every review | the same, read from a file, for anything long or multi-line                                    |
| `--overview-style <names>`   | every review | how the overview and each chapter are written beneath their opening sentence — see below       |
| `--split-hunks <lines>`      | every review | split a hunk of more changed lines than this into parts of about this size — see below         |
| `--stub`                     | every review | write a mechanical review instead of running a model — see below                               |
| `--from <stage>`             | every review | resume the newest run for this target at `prompt`, `run`, `parse` or `render` — see below      |
| `--no-open`                  | every review | write the report without opening it                                                            |
| `--keep-worktree`            | PR reviews   | leave the PR's temporary worktree in place instead of removing it                              |
| `--allow-large`              | every review | run the model on more than 300 reviewed files, which `er` otherwise refuses (it warns past 50) |
| `-h`, `--help`               | —            | show usage and exit                                                                            |
| `-v`, `--version`            | —            | show the installed version and exit                                                            |

`--staged` (a target, not an option) and `--base` cannot be combined: the
staged tree has no branch to compare against but `HEAD`.

### Your own instructions

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

### How finely hunks are split

`--split-hunks` sets how finely a long hunk is cut. Git makes a hunk out of
nearby changes, so a new file is one hunk however many things it does, and a
chapter that wants one function of it has to show all of it. `er` cuts any hunk
of more than 10 changed lines (the default) into parts of about that size,
between declarations, and the model can then tell each part in the chapter it
belongs to. A TypeScript or JavaScript test file is cut between its test cases
and hooks, and never inside one, however long. `0` keeps git's hunks. It cannot be given with `--from`, which
reuses the hunks the last run numbered.

### Overview styles

`--overview-style` chooses how the overview and each chapter are written
beneath their opening sentence (the overview's lede, a chapter's headline),
which never changes:

| Style          | The text beneath the opening sentence                                 |
| -------------- | --------------------------------------------------------------------- |
| `narrative`    | the default: why it changed, and the tradeoffs, in prose              |
| `before-after` | **Before:** / **After:** pairs, one per behaviour that changed        |
| `five-whys`    | a chain of why-questions down to the reason, rarely all five          |
| `plain`        | two or three plain sentences for someone who has never seen this code |
| `simple`       | short sentences in everyday words, for an engineer new to this area   |
| `pros-cons`    | **Pros** and **Cons** lists: what the change gains and what it costs  |
| `tldr`         | nothing: the opening sentence alone carries the change or its risk    |

Name several, comma-separated, or `all`, to compare them on the same review:

```bash
er review 42 --overview-style narrative,simple,pros-cons
```

The report opens on the first style named, so `simple,all` is every style,
opening on `simple`.

The model then writes every body once per style, on the same chapters, and the
report puts a row of tabs, one per style, above the summary's overview and
above each chapter's body; a tab picked in one place is the style everywhere,
and the choice is remembered for the next review. A passage has a body in every style or in none: a chapter left out of
one style, or a body under a style that was not asked for, fails the review
rather than shipping a comparison that is not like for like. The
headlines are shared, so `tldr` in a list asks the model for nothing and shows
as **Headlines only**. Each extra style adds roughly a thousand output tokens,
a few cents, but a longer answer the model must get right in one go, which is
why one style stays the default.

The prompt stage line names the styles when they are not `narrative` alone.

The instructions and the styles are written into `prompt.md` (the styles also
into `styles.json`, which the parse stage reads back), so `--from run` reuses
them; they cannot be given with `--from run`, `parse` or `render`,
which write no new prompt. `--from prompt` writes the prompt again from that
command's flags, so repeat them there to keep them.

## What it costs, and how long

The model run is the only stage that costs anything.
Measured on two of this repository's own pull requests:

|           | #18: 23 files, 96 hunks                 | #22: 10 files, 37 hunks                 |
| --------- | --------------------------------------- | --------------------------------------- |
| Turns     | 4                                       | 6                                       |
| Wall time | 6 minutes                               | 10 minutes                              |
| Cost      | **$1.62** of your own allowance         | **$1.85** of your own allowance         |
| Tokens in | ~511k, of which 84% was read from cache | ~436k, of which 94% was read from cache |
| Report    | 2.3 MB of HTML                          | 1.9 MB of HTML                          |

That is what an agentic review costs: it pays for its whole context on every
turn, so the bill tracks the number of turns more than the size of the diff.
The run line reports all of it as it finishes, cache share included.

A very large change does not finish yet: on a 72-file change of 379 hunks the
answer outgrows the model's output limit, so the run stops without a review
(ER-56).

Two ways to spend nothing while working on the tool itself:

```bash
er review --stub
```

A mechanical review with one chapter per file — no model, no cost, and the
right way to iterate on the reader. Every hunk is read, except one `er` can
prove is whitespace-only, which is skim — as it is in any review — so the
reader's faded lines show too, and the first chapter stands in
as the reading plan's brief.

```bash
er review --from parse
```

Re-runs only the later stages against the answer the last run already saved.
Every stage writes its input and output to the run folder, so `--from prompt`,
`run`, `parse` or `render` picks up the newest run for that target. If a
review fails to parse, its text is still on disk and this is how you rebuild
the report without paying twice.

## Where it writes

`er-reviews/<target>/<timestamp>/` inside the repository under review,
ignored by git automatically. The report is `review.html`, and it opens when
it is written unless you pass `--no-open`. Beside it sit the stage files:
`context.json` (what changed), `prompt.md`, `system.md` and `styles.json` (what was asked),
`raw.txt` (what the model said), `events.jsonl` (what it did, what it cost,
any command the read-only gate refused and any answer it was asked to write
again), `review.json` (the parsed review), `findings.json` (what validating
it turned up) and `excerpts.json` (the unchanged files the review shows
excerpts of, as the reviewed commit has them). A run folder is a complete
record; delete the tree whenever you like.

The report is a single file: every script, style and font is inlined, so there
is nothing beside it to keep or to send. The diff editor is the exception — it
is fetched from a CDN when a diff is opened, which keeps the file small enough
to email. Reading the review needs no network; reading a diff does.

The report remembers which chapters you marked read in the browser's own
storage, keyed by the repository and the two commits reviewed, so rendering
the same range again keeps your place. Nothing about it leaves the browser.

`er review` exits 0 for a clean review, 2 for one that was written but carries
warnings — each of them printed as it finishes — and 1 when there is no review
to open.

## What the model may do

It gets `Read`, `Glob` and `Grep`, and `Bash` for read-only history —
`git log`, `git show`, `git blame`, `git diff`, and `rg`/`grep`/`ls`/`cat`
piped together. Every command is checked before it runs
(`src/cli/bash-gate.ts`), and anything that could write, or reach a program
not on the list, is refused with a message saying what it may run instead.
Refusals are recorded in `events.jsonl` and reported as one warning when the
review finishes; a review is never failed by one.

`--model`, `--max-turns` and `--timeout` override the defaults it runs with —
see [Every option](#every-option).

## Diagrams

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

## Known gaps

The model run is not covered by automated tests: tests stop at the Agent SDK
boundary and use `--stub`, so the real SDK call is exercised by hand rather
than CI.
