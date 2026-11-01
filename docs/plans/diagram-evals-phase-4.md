# Diagram evals — phase 4: a rubric judge

Part of ER-62; the plan of plans is `diagram-evals.md`. Same branch and PR.
Deleted when the work lands.

## What it answers

Tier 0 counts whether a diagram was drawn and of what kind, never whether it
is any good; the contact sheet answers that by eye, one sweep at a time. The
judge reads every overview of a sweep and rates it, so a prompt change can be
compared on quality without the user rating 21 pictures each time — once its
ratings are shown to agree with the user's.

## Decisions (asked and answered)

- **The judge reads the diagram's content, not a picture of it**: title,
  caption, nodes (label, kind, change, path), groups and edges, as text.
  Layout stays the eye's.
- **Overviews only.** Each is judged against its branch's `question` and
  `mustName`, which the branches already carry. Chapter diagrams have no
  question yet.
- **One scale for everyone: good / usable / poor.**
  - good: a reader who has never seen the code answers the question from
    the picture and its caption alone, and every mechanism is shown;
  - usable: the question can be answered, but a mechanism is only partly
    shown or missing, or the picture carries noise the reader must look past;
  - poor: the question cannot be answered from it, or it shows something
    the change does not do.
- **The user rates on the contact sheet**: a good / usable / poor control
  under each overview, kept in the browser, and a button that downloads
  `ratings.json`, saved into the sweep's folder.
- **Two judge models** (`--judge <model>`, repeatable; Opus and Sonnet by
  default), since the model that drew the diagram may favour its own work.

## Pieces

- `src/evals/diagram-judge.ts`:
  - **The prompt.** The change's title and description (what really
    happened), the question, the mechanisms, the rubric, and the diagram as
    text.
  - **What the judge answers.** It writes its answer to the question from the
    picture alone before anything else, so it has to read the picture. Then,
    for each mechanism, whether it is shown (yes / partly / no). Then the
    rating, with one sentence of why. All of this goes in a
    `<diagram_judgement>` JSON block.
  - **Strict parsing**, as the skim answer is read: a problem goes on the
    record and is not repaired.
  - **`runJudge`.** Every sample's overview × every judge model, through
    `runSdkLoop` with no tools and one turn, `parallel` at once. Results go to
    `<sweep>/judgements/<model>/<branch>/sample-<n>.txt|.json`, plus a
    `judgements.json` record. A sample with no overview has nothing to judge.
    Needs ANTHROPIC_API_KEY.
- `src/evals/diagram-agree.ts`:
  - **Inputs:** the user's `ratings.json` against each judge, and the two
    judges against each other.
  - **What it reports for each pair:**
    - exact agreement;
    - agreement within one step;
    - Cohen's kappa, since a sweep that is mostly "good" makes raw
      agreement flatter;
    - every disagreement, with the judge's reason.
- **The bin:**
  - `judge <folder> [--judge <model>]... [--parallel <n>]`;
  - `agree <folder>`;
  - `score` gains a line per branch of each judge's ratings once a sweep has
    judgements.
- **The sheet:**
  - the rating control and the ratings download;
  - each judge's rating and reason under an overview, behind a "Show the
    judges" switch that is off by default, so the user rates unprompted.

## Done when

The judge, its parser, the agreement and the sheet's rating control are
tested with the model faked; the gate is green; the user has rated one sweep
and the judges' agreement with them is reported. The judge's number is
quoted for a prompt change only once that agreement is good.
