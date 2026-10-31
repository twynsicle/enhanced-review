# Diagram evals — phase 2: the sweep, the score and the contact sheet

Part of ER-62; the plan of plans is `diagram-evals.md`. Same branch and PR as
phase 1. Deleted when the work lands.

## What the hand-run showed

One real review of `retry-queue` (kept locally under
`er-reviews/packhouse-retry-queue/`):

- The overview was an architecture map, the kind expected, with good
  mechanism edges, but one node in five unchanged and none of the four
  untouched files the branch expects it to reach.
- A chapter drew a state diagram the expectation does not allow, every edge
  marked added, the old capture-to-paid path included.
- The parser dropped a `filename` the model put on a data node
  (`diagram-part-dropped`): the model already tries to ground nodes the
  schema will not let it.
- The first answer was disqualified (invalid JSON) and a retry produced the
  review. `er` exits 2 on that warning with the report written; a runner that
  treats any non-zero exit as failure loses a good run.

## Shape

```
evals/diagrams/results/<stamp>/
  run.json                    model, samples, branches, each branch's digest, cost, start and end
  <branch>/sample-<n>.json    exit code, ms, cost, turns, the failure if er failed
  <branch>/sample-<n>/        the whole run folder: review.json, findings.json, review.html, …
  sheet.html                  the contact sheet, written by `sheet`
```

- **`run`** stands each branch up afresh per sample (`withContrivedBranch`)
  and runs `er review --no-open [--model]` there as a subprocess, `parallel`
  at once, then copies the run folder out before the tree goes. Exit 0 and 2
  both mean a report was written. Exit 1 is recorded as a failed sample with
  the tail of er's output, and scored as a failure, never as "drew nothing".
  Refuses without `ANTHROPIC_API_KEY`, as the skim sweep does
  (`requireApiKey`), so a sweep spends API credit and never a plan sign-in.
- **The digest** of a branch is a hash of the base, the branch's files and its
  spec minus `expect`. `score` and `sheet` refuse a sweep whose branch has
  changed since, so a before-and-after is always the same change. Editing
  `expect` rescores without a new sweep.
- **`score`** reads each sample's `review.json` and `findings.json`:
  - drawn against deserved: the overview present when deserved and absent when
    not, of an allowed kind; the count of chapter diagrams within the range
    and each of an allowed kind; a sample is **on target** when all hold;
  - per diagram: nodes (participants for a sequence), the unchanged share,
    the identifier-label share (a label carrying a code-shaped token:
    camelCase, PascalCase with two capitals, `_`, `.`, `/`, `()`), the
    labelled-edge share (graph edges; a sequence message always has one);
  - `mustReach` files grounded by any node's `filename`;
  - the parser's diagram drops and retries, from `findings.json`;
  - per branch and pooled as `mean (min–max)` across samples, with the skim
    eval's `spread`.
- **`sheet <sweep> [<other>]`** renders every diagram of a sweep, or two
  sweeps one band above the other, to one static page: a row per branch with
  what it deserves, the question, the mechanisms and files it should show;
  then each sample across, its verdict line, its overview and its chapter
  diagrams with only the chapter's title, and a link to that sample's
  `review.html`. Drawn by the report's own `DiagramFigure`, so the sheet shows
  exactly what a reader sees.

## The sheet's build

The sheet is a second page under `src/report/sheet/` with its own
`vite.sheet.config.ts`, built to one inlined `build/sheet/sheet.html` with an
empty data element, filled the way the report's bundle is. The inlining
plugin moves out of `vite.config.ts` into `vite.inline.ts` so both builds use
it. `sheet-data.ts` (the data's schema and the element) uses relative `.ts`
imports so the eval can load it in Node, and the layering guardrail gains
`evals → report`. `sheet` builds the page each time it runs: it takes
seconds and a sheet is made by hand.

The sheet is not in the gate's build; a happy-dom test renders the page from
a small sheet so it cannot rot unseen.

## Decisions

- **Whole run folders are kept**: about 2 MB a sample, ignored by git, and
  the review behind a surprising diagram is one click away.
- **A failed sample is a result.** A prompt that fails reviews more often is
  worse, and the score says so on its own line.
- **Three samples by default** (`--samples`), `--parallel 3`: a sweep of six
  branches is eighteen reviews, roughly fifteen dollars and ten minutes.

## Done when

`run`, `score` and `sheet` work, tested without a model; the score and the
sheet work on the hand-run review; the gate is green; a baseline sweep on
today's instructions has been run and its summary recorded in this plan,
which needs `ANTHROPIC_API_KEY` exported in the shell that runs it.
