# Diagram evals — plan of plans (ER-62)

One PR per phase. Each phase gets its own just-in-time plan before any code;
this file fixes the shape, the order and the decisions that cut across
phases. Deleted when the work lands.

## Goal

A review's diagrams should show how the change sits in the wider system: what
the moving pieces are, named by what they do rather than by their file, with
the pieces the change did not touch drawn around the ones it did. A diagram
should be drawn when it helps and left out when it does not, and a change to
the diagram instructions should be a before-and-after comparison on the same
cases, not one more review that looked about right.

## What the local runs show

Across the 26 runs in `er-reviews/` there are 41 diagrams. Nearly half their
node labels are identifiers (a file name, a function name), one node in five
is marked `unchanged` although the instructions say most should be, and runs
of the same pull request two weeks apart drew three diagrams and then none,
with no instruction about diagrams changed between them. The instructions
also contradict themselves: an architecture diagram's nodes "will mostly be
unchanged", but a node may only be grounded in a changed file and the model
may "draw only what the diff supports".

## Decisions that hold across phases

- **One diagram style per run, chosen by a flag.** `--diagram-style
  <mechanism|files>`, default `mechanism`, written into the run's context so
  `--from` reuses it. `files` is today's behaviour: nodes are the changed
  files and what they call. `mechanism` draws the parts of the system the
  change moves through, named by their responsibility, the untouched
  neighbours included. The model does not choose between them, and a run
  does not produce both; that may come later, the way overview styles did.
- **An unchanged node may point outside the diff.** It carries a `filename`
  from anywhere in the repository and an optional line span. The parse stage
  checks both against the head commit with git, as it checks context excerpts,
  and the bundle embeds the span the same way. A node in a changed file keeps
  its hunk grounding. The label is the responsibility; the path is drawn
  beneath it in the caption type.
- **The eye judges first.** The eval measures what needs no judgement (whether
  a diagram was drawn, of what kind, how many nodes, how many unchanged, how
  many labels are identifiers, how many edges are labelled, what the parser
  dropped) and renders every diagram of a sweep onto one contact sheet, cases
  down and samples across, with no chapter prose beside them. A rubric judge
  comes only once the sheet has shown what good looks like.
- **Cases are built backwards from the picture wanted.** Each is a branch on a
  model system of its own, wide and shallow, under `evals/diagrams/`, in this
  repository: the clone already carries the skim fixtures and nothing is
  installed separately, so a second model system costs a user nothing. Each
  branch's spec carries what it deserves: an overview of which kind or none,
  how many chapter diagrams of which kinds, the mechanisms the overview must
  name and the untouched files it must reach. Nothing in a branch says what it
  is for.
- **A sweep runs whole reviews.** Whether a diagram is drawn is decided while
  the model chapters the change, so the eval runs `er review` end to end on
  the stood-up repository, several samples a case. The model system is small
  enough that a sample costs well under a dollar.
- **The contrive machinery is shared.** Standing a base up as a repository
  with a bare origin and laying a branch over it moves out of the skim eval
  into one module both evals call, with the base, the repository's name and
  its author as parameters.

## Phases

### 1. The model system and its cases (`evals/diagrams/`, `src/evals/`)

A fulfilment service with real boundaries between its parts, and six
branches, each written from the diagram it should produce: an architecture
map, a state machine, a sequence, a before-and-after, a control that deserves
no diagram, and a mixed change where one chapter earns a picture and the rest
do not. A `contrive` command that stands each up, runs a stub review and
reports the change's size; the model system's own tests run on the base and
on every branch. No model runs. Plan: `diagram-evals-phase-1.md`.

### 2. The sweep, the score and the contact sheet

`run` sweeps every case through whole `er review` runs, `--samples` each,
keeping each run's `review.json` and `findings.json` under
`evals/diagrams/results/<stamp>/`. `score` reports, per case and pooled, with
the skim eval's `mean (min–max)` spread: drawn against deserved (overview
present and of an allowed kind; chapter diagrams within the range and of the
allowed kinds; a control with none), node counts, the unchanged share, the
identifier-label share, the labelled-edge share, the untouched files reached,
and the parser's drops. `sheet` renders a sweep's diagrams to one static HTML
page through the report's own painters (the layering guardrail gains
`evals → report`), a second sweep beside the first when given. Ends with a
baseline sweep on today's instructions, committed as a summary so phase 3
has a number to beat.

### 3. The style flag and the mechanism style

The flag, the two instruction texts, and outside-diff grounding end to end:
schema, parser, parse stage, bundle and reader (the path subline, and what a
click on an untouched node opens). Measured against the phase 2 baseline on
the same cases, and confirmed on a real run or two of a pull request from
this repository, since the model system is not this repository.

### 4. A rubric judge (later)

A judge model scores each overview against its case's mechanisms and
question, two judge models to blunt either's bias, validated against the
user's own ratings from the contact sheet before its number is trusted.

## Out of scope here

The model choosing a style per diagram; several styles in one run; a Mermaid
export; diagrams in the file view; a judge before phase 4.
