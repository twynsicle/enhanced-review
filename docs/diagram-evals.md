# The diagram eval

Whether the model draws the diagram a change deserves, and nothing when it
deserves none, judged on changes written for the purpose. It exists so that
a change to the Diagrams section of the review instructions is a
before-and-after comparison on the same cases, rather than one more review
whose pictures looked about right.

It is not part of `npm run check`. A sweep runs whole reviews and spends
money, so it is run by hand, before a change to the diagram instructions is
merged, and its figures and its contact sheet compared with the last
sweep's.

## What a case is

A branch over a model system kept in this repository, written from the
diagram it should produce and then dressed as an ordinary change: a
description as the engineer would write it, tests, and the small edits that
ride along with real work, so that the picture has to be chosen out of the
change rather than handed to the model by the change's shape. Unlike a skim
case, nothing is cut from the branch and kept: the model needs the
repository, not a diff, so a sweep stands the branch up again each time. The
branch is the case.

```
evals/diagrams/contrived/
  base/                 packhouse, the order service every branch starts from
  <name>/branch.json    the branch name, its title and description, the commit message, any
                        paths the branch deletes, and what the change deserves
  <name>/files/         the files the branch changes or adds, whole, laid over the base
```

### The model system

Packhouse is the order service of a small merchant: orders come in over
HTTP, payment is captured through an external card gateway, packing and
shipping go to a worker through a job queue, a carrier is booked, the
customer is emailed, and a scheduler sweeps stuck orders, with an ops CLI
beside it. It is wide and shallow on purpose. Every part is thin, and the
point of each is the boundary it sits on: three externals, a store, two
actors, and two asynchronous seams. The order status is a state machine from
day one, so a branch that changes it has something to change. It has no
dependencies, so its tests run with `node --test` and no install.

The README describes the parts, as a real service's would. A mechanism map
drawn from a README is still a mechanism map; the eval measures whether the
model draws one, not whether it reverse-engineers it.

### Writing a branch

Start from the picture: what should a reader see, and what question should
the overview answer on its own? Then write the change that earns it, with
its tests, and dress it. Each branch shows one thing:

| branch               | the picture wanted                        |
| -------------------- | ----------------------------------------- |
| `retry-queue`        | an architecture map, most of it unchanged |
| `on-hold`            | a state machine, a map if it likes        |
| `async-capture`      | three endings, as a sequence or otherwise |
| `address-middleware` | a before-and-after of one path            |
| `timestamps`         | nothing: the control                      |
| `carrier-switch`     | one chapter's picture, the rest none      |
| `status-feed`        | a map whose worker is one part, not three |

The last two are what make "drawn when it helps" measurable: without them a
prompt that draws on every change scores as well as one that draws when it
should.

Nothing the model could read may say what the branch is for: not the title,
the description or the commit, and not any file under `files/`. `contrive`
refuses a branch that uses `fixture`, `contrived`, `eval`, `sample`,
`synthetic` or `diagram` anywhere in them, and a test holds the committed
branches to the same words.

### `branch.json`

The skim eval's spec, plus `expect`, which the model never sees:

```json
{
  "branch": "feat/retry-failed-captures",
  "title": "Retry a capture the gateway failed instead of cancelling the order",
  "description": "…as the engineer would write it…",
  "commit": { "subject": "…", "body": "…" },
  "removed": [],
  "expect": {
    "overview": { "kinds": ["architecture"] },
    "chapterDiagrams": { "min": 0, "max": 1, "kinds": ["sequence"] },
    "mustName": ["a capture failure enqueues a retry", "the scheduler drains retries with backoff"],
    "mustReach": ["src/payments/gateway.ts", "src/worker/worker.ts"],
    "question": "Where does a failed capture go now, and what still reads the order while it waits?"
  }
}
```

- `overview` is `null` when the change deserves none, else the kinds an
  overview may be.
- `chapterDiagrams` bounds how many chapters may carry one and of which
  kinds; `max: 0` is the control.
- `mustName` is prose: the mechanisms the overview should name, for whoever
  reads the contact sheet and for a judge later. `mustReach` is the
  untouched files a mechanism map should ground, counted once a node may
  reach outside the diff, or a folder ending in `/` that a part spanning
  several files should be grounded in whole; a node grounded in a folder
  reaches every file under it, and a folder is reached only by itself or a
  folder above it. `question` is what a reader should be able to
  answer from the overview alone.

## Checking a branch

```bash
npm run eval:diagrams -- contrive retry-queue
npm run eval:diagrams -- contrive --all
```

That runs the model system's tests on the base, then stands each branch up
as a throwaway repository with a bare origin, runs the tests on its tree,
runs `er review --stub --no-open` there, and prints the change's size: the
files and hunks a review would see, and the lines the diff adds and removes.
Nothing is kept. A branch whose tests fail is a change an engineer would not
have opened, and the command fails on it rather than reporting a size.

## Running a sweep

```bash
npm run eval:diagrams -- run
npm run eval:diagrams -- run --branch on-hold --branch timestamps --samples 5
```

Every branch, three samples each, three at once; `--branch` limits it,
`--samples` and `--parallel` change the counts, `--model` picks the model,
`er`'s default otherwise, and `--diagram-style` the style every review draws
in, `mechanism` otherwise. The style is recorded with the sweep and named on
the contact sheet, so `--diagram-style files` sweeps the earlier style from
the same code for a comparison. Each sample stands its branch up afresh and runs a
whole `er review` there, so a sample costs what a review of the change costs:
roughly thirty cents on these branches, and a sweep of all seven, three
samples each, about six dollars and eight minutes. Like the skim eval, it needs `ANTHROPIC_API_KEY` and
refuses without it, so it spends the API credit a plan includes and never
the plan's own allowance.

Each run folder is kept under `evals/diagrams/results/<stamp>/`, which is
ignored by git, with how `er` exited beside it. A review written with
warnings is a sample like any other; a review `er` failed to write is a
failed sample, counted as a failure and never as "drew nothing". The sweep
records a digest of each branch, and scoring a sweep whose branch has changed
since is refused, so a before-and-after is always the same change. Editing a
branch's `expect` does not change the digest: the answers already paid for
are rescored against it.

## Reading a sweep

`run` ends by scoring the sweep, and `score` does it again:

```bash
npm run eval:diagrams -- score evals/diagrams/results/20261031-091500
```

For each sample, whether it drew what the branch deserves: the overview
present when deserved and absent when not, and of an allowed kind; the
chapter diagrams within the range and of the allowed kinds. A sample is on
target when both hold, and **missed** when it drew fewer than deserved: no
overview where one was due, or fewer chapter diagrams than the least. A
missing diagram is the costlier error, so expectations are written wide
enough that a second angle on the same thing still counts, and `missed one`
is the figure to watch. Then, of what was drawn, as `mean (min–max)` across
the samples:

- **nodes** a diagram, a sequence's participants counting as nodes;
- **unchanged**, the share of nodes the change did not touch, which a map of
  the system around the change should be mostly made of;
- **identifier labels**, the share of nodes named by a code-shaped word
  (`createOrder`, `RetryQueue`, a path) rather than by what they do;
- **labelled edges**, the share of edges that say what passes along them;
- **reached**, how many of the branch's `mustReach` paths some node is
  grounded in;
- **parser drops**, the parts of diagrams the parser had to remove, and how
  many answers needed a retry.

The figures are written to `score.txt` in the sweep's folder.

They cannot say whether a picture is any good. The contact sheet is for that:

```bash
npm run eval:diagrams -- sheet evals/diagrams/results/20261031-091500
npm run eval:diagrams -- sheet evals/diagrams/results/20261030-221500 evals/diagrams/results/20261031-091500
```

One page, a row per branch with what it deserves, the question its overview
should answer, the mechanisms it should name and the files it should reach;
then each sample across, its verdict, its counts and every diagram it drew,
with only the title of the chapter that carries it and none of the review's
prose. The test is whether each picture can be understood on its own. Given
two sweeps, each row shows the earlier above the later. The page is written
into the (later) sweep's folder, and each sample links to its whole review.
It is drawn by the report's own diagram code, built from
`vite.sheet.config.ts` each time.

## Judging a sweep

The sheet is the eye's verdict, one sweep at a time. A judge model gives a
verdict a prompt change can be compared on without rating every picture
again, once it is shown to agree with yours:

```bash
npm run eval:diagrams -- judge evals/diagrams/results/20261031-091500
```

Each judge reads each overview as text: its title, caption, nodes (label,
kind, change, path, group) and edges, never the rendered picture, whose
layout stays the sheet's. It is told what the change really does, the
branch's `question` and its `mustName` mechanisms. It answers the question
from the overview alone, says whether each mechanism is shown (yes, partly,
no), and rates the overview:

- **good**: a reader who has never seen the code answers the question from
  the picture and its caption alone, and every mechanism is shown;
- **usable**: the question can be answered, but a mechanism is only partly
  shown or missing, or the picture carries noise the reader must look past;
- **poor**: the question cannot be answered from it, or it shows something
  the change does not do.

Two judges by default, Opus and Sonnet (`--judge <model>`, repeatable), since
the model that drew a diagram may favour its own work. Their answers go under
`judgements/` in the sweep, replacing an earlier judging, and `score` then
counts each judge's ratings per branch. Chapter diagrams are not judged: no
branch says what its chapter picture should answer. A judging costs a few
cents an overview.

**Your ratings.** The sheet puts a good / usable / poor control under each
overview. Rate before ticking "Show the judges", which reveals each judge's
rating and reason. The ratings stay in the browser; "Download ratings" saves
them as `ratings.json`, which goes into the sweep's folder (a sheet of two
sweeps rates both, each by its stamp, so the one file serves both folders).
Then:

```bash
npm run eval:diagrams -- agree evals/diagrams/results/20261031-091500
```

For you against each judge, and the judges against each other: how often they
agree exactly, how often within one step, Cohen's kappa (raw agreement
flatters a sweep that is mostly "good"), and every disagreement with the
judge's reason. Quote a judge's ratings for a prompt change only once its
agreement with yours is good; the reasons it gives where you differ are what
to fix in the rubric.
