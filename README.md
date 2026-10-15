# enhanced-review

**A code review you read like a story, not a diff.**

`er` is one command, run inside your repository. It has Claude review a
branch, a pull request or your staged changes, and writes the result as a
single `review.html`: the change told as chapters in the order to read them,
each beside the diffs that show it, with a risk assessment, diagrams of what
changed, and a reading plan for when you have five minutes rather than fifty.

<!-- The screenshots are attachments on https://github.com/twynsicle/enhanced-review/issues/33, which says what they were taken from and how to retake them. -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/01d85cf5-a4d1-4fe0-ae34-1381b304b0e4">
  <img alt="An er report: the summary of a 23-file pull request, with its overview, reading plan and chapter list" src="https://github.com/user-attachments/assets/04987385-f817-4bb3-8f5b-1c0a6313e76a">
</picture>

## Why

A diff lists every changed line, file by file in alphabetical order, and
gives each the same weight. On a change of any size the reviewer's first job
is to work the story out of that list: where to start, which hunks matter and
which are a rename rippling outwards, and what the change is for. That is most
of the effort of a review, and it is the part that gets skipped when time is
short.

`er` does that part first. It reads the change with the repository around it,
then tells it back as a handful of chapters — one idea each, with only the
hunks that show it — and says which of it you can afford to skim. You still
read the code, in an order that makes sense, with someone having already said
what it is for.

It works before a pull request exists, which makes it a good way to check work
an agent wrote for you.

## What a review gives you

### A reading plan

The summary opens with an overview and three ways through the change — Brief,
Standard and Full — each with a time estimate and the chapters it adds. Read
the brief when that is all the time there is; the chapters you leave out are
the ones that can wait.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/1f54cd4a-8c46-4832-b9e9-6a454ed32f7d">
  <img alt="The reading plan: Brief, Standard and Full, each with its estimate and the chapters it adds" src="https://github.com/user-attachments/assets/853a6aec-3d2b-469d-a1cc-5cbe9cc9142a">
</picture>

### Chapters, with the code beside the prose

Each chapter leads with one line saying what changed or what to worry about,
then why, then the diffs it cites: real side-by-side diffs, only the hunks
that chapter is about. A note about one file sits on that file's diff. Below
the diffs is the unchanged code the change reaches without editing it — the
caller whose behaviour shifts, the limit a new path now runs into.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/ffee7142-85ef-4b9c-9011-a0be5a6d2ece">
  <img alt="A chapter: its lede and reasoning, then the diffs it cites, with a block of moved code marked" src="https://github.com/user-attachments/assets/82697da1-9d0b-4fad-9591-c41fb53f0bf8">
</picture>

### A risk assessment

How risky the change is to merge, scored from one to five, with the reasoning
and the factors that raise or lower it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/a43d4117-d640-4bc8-aa4c-5554da3f628a">
  <img alt="The risk assessment: a score and the concerns behind it" src="https://github.com/user-attachments/assets/414056e5-0a61-460f-a911-3f66facc07c5">
</picture>

### Diagrams of the change, not the system

Where a picture helps, the review draws one: an architecture map, a state
machine, a before and after, or a sequence. Every node and edge says whether
the change added, removed or modified it, and a node for a file opens that
file's diff.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/d3b7e57c-45ae-47bf-bf2c-59bd83abf324">
  <img alt="A diagram of what the change did, with added, modified and unchanged parts marked" src="https://github.com/user-attachments/assets/8bbaf0fc-ae31-4516-b201-eacebfb0be46">
</picture>

### Questions only you can answer

Some things the code cannot settle — whether a behaviour is intended, which of
two policies is right. Rather than guess, the review puts them back to you as
judgement calls, each on the code it is about.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/c45e64e7-bd5c-4d4e-b2d0-3b297d757dc9">
  <img alt="A judgement call: a question the review asks the reader, above the diff it concerns" src="https://github.com/user-attachments/assets/adb3eb52-5db6-4045-99ec-0de20c60cb1a">
</picture>

### What to skim

A hunk `er` can prove is mechanical — whitespace only, imports only, or code
moved from elsewhere in the change — is tagged as such, and the review marks
the rest that need only a glance. Turn on skim marks and they fade, so the
lines that need reading stand out.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/fb18dca3-ce10-4eb6-a401-5d83b0bf1d17">
  <img alt="A diff card with a note anchored to it, and an imports-only hunk labelled as skim and faded" src="https://github.com/user-attachments/assets/2f19ab98-7dc3-48a9-8327-801803ff424e">
</picture>

### Nothing left out

Every hunk the model is shown must be placed in a chapter; an answer that
leaves one out is sent back, and a review that still does not hold up fails
rather than looking complete. The sidebar marks any file the chapters skipped
or only partly covered, and a file's own view shows every hunk, discussed or
not.

And the smaller things: chapters you mark read are remembered, each chapter
copies a ready-made prompt to ask Claude Code about it, the overview can be
written in six styles from prose to a checklist, `--instructions` tells the
review what to look hardest at, and the report follows your light or dark
theme.

## Your code stays yours

`er` has no server, opens no port and uploads nothing. It runs Claude **as
you** — your own sign-in or API key, your own settings — and the agent it runs
can only read: `Read`, `Glob`, `Grep`, and a `Bash` limited to read-only git
commands (`log`, `show`, `diff`, `blame` and the like) and `rg`, `grep`, `ls`,
`cat`, `head`, `tail` and `wc`, with every command checked before it runs
([`src/cli/bash-gate.ts`](src/cli/bash-gate.ts)).

What reaches the network, and why:

- **GitHub**, through your own `git` and `gh`: fetching the branch or pull
  request under review, and reading a pull request's title, description and
  base.
- **Anthropic**, through the Claude Agent SDK: the prompt, and whatever the
  agent reads from the repository while it reviews.
- **cdn.jsdelivr.net**, from the report in your browser: the Monaco diff
  editor, pinned to one version, fetched when a diff is first shown. Nothing
  about the review is sent with that request.
- **npm**, once, when you install `er`.

You install `er` by cloning this repository, so everything it runs is here to
read first. The report is one self-contained file — every script, style and
font inlined — that you can keep, delete or send to a colleague.

## Quick start

You need Node 24 or later, `git`, `gh`, and either a Claude Code sign-in or an
`ANTHROPIC_API_KEY`.

```bash
git clone https://github.com/twynsicle/enhanced-review.git
cd enhanced-review
npm install
npm link
```

Then, inside the repository you want reviewed:

```bash
er review
```

That reviews the current branch against its pull request's base, or the
default branch when there is no pull request. `er review 42` reviews pull
request #42 and `er review --staged` what you have staged. The report opens in
your browser when it is written. The review most of these screenshots come
from, of a 23-file pull request, took six minutes and $1.62 of your own Claude
allowance.

**[docs/usage.md](docs/usage.md)** has the rest: every option, stacked
branches, your own instructions, overview styles, what a run costs and where
it writes.

## Development

[AGENTS.md](AGENTS.md) is the map of the tree, with the layering rules the
guardrail tests enforce; [.claude/rules/](.claude/rules/) holds the detail for
each area.

| Script               | What                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `npm run check`      | **The gate**: typecheck + report:build + test + lint + format:check |
| `npm run report:dev` | The report, against a committed sample review                       |
| `npm run test:watch` | Vitest: unit + report + guardrails                                  |

`er review --stub` writes a mechanical review with no model run, which is how
to work on the reader for nothing. The tests never call the Anthropic API:
they stop at the Agent SDK boundary and use `--stub`.
