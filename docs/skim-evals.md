# The skim eval

How well the model tiers hunks: which it marks `read` and which `skim`, judged
against a person's answer on real changes. It exists so that a change to the
tiering rules in the review instructions is a before-and-after comparison on
the same cases, rather than one more review that looked about right.

It is not part of `npm run check`. A sweep spends money and the model is not
deterministic, so it is run by hand, before a change to the rules is merged,
and its figures compared with the last sweep's.

## What a case is

One whole change, as the prompt stage shows it to the model, with a label on
every hunk. Never hunks gathered from several changes: a hunk's tier depends
on the rest of the change it is in, since a rename's call sites are skim only
beside the rename, and a shared fixture is skim only beside the cases that
use it. The model is asked for every hunk's tier in one answer, as it is in a
real review, and the statistics come from asking several times, not from
packing more into one call.

```
evals/skims/cases/<name>/
  case.json       what the prompt shows: title, description, commits, files, the hunk catalog
  diff.patch      the change, each hunk's id on a `# H0001` line above its header
  labels.jsonl    one line per hunk; the only file a person edits
```

Cases are committed. They are cut from merged pull requests, or built from a
branch written for the eval, so no live review ever sees its own answer key in
the checkout.

## Making a case

Any `er` run folder becomes a case:

```bash
npm run eval:skims -- import er-reviews/pr-38/20261016-080937 --name pr-38
```

It copies the run's hunk catalog and diff, and seeds each label's tier from
the run's own `review.json`, since correcting the model's answer is far
quicker than labelling from nothing. A `--stub` run has no review, so every
tier seeds `read`.

### Contrived cases

A real pull request carries each kind of skim only as often as it happens to,
so a rule about one kind — moved code, say — is measured on a change made
to show it. Those live under `evals/skims/contrived/`:

```
evals/skims/contrived/
  base/                 one small service, the tree every branch starts from
  <name>/branch.json    the branch name, its title and description, the commit message, and
                        any paths the branch deletes
  <name>/files/         the files the branch changes or adds, whole, laid over the base
```

Each branch shows one kind several times over, beside ordinary read hunks and
at least one trap: a hunk that looks like the kind and is not, such as a
moved block that changed a line on the way, or a rename under which a
condition changes. Some traps are noise rather than disguise: a hunk that is
wiring for all but its last line, where a behaviour change rides along,
because hunks are cut by git and the splitter, not by meaning, and a rule has
to hold on the hunks a real change arrives in. The case is built from it:

```bash
npm run eval:skims -- contrive moved
npm run eval:skims -- contrive --all
```

That stands the base up as a throwaway repository with a bare origin, commits
the branch over it, runs `er review --stub --no-open` there and imports the
run as `evals/skims/cases/<name>`, with the title and description from
`branch.json`. The repository is thrown away; the case is committed, and the
branch is how it is made again. The import refuses to overwrite a labelled
case, so delete the case folder first to rebuild one.

The description goes to the model as a pull request's would, so it is written
as the engineer would have written it, and nothing in the branch may say what
it is for: no "fixture", "eval" or "skim" anywhere the model reads (a test
holds the specs to that).

## Labelling

Each line of `labels.jsonl` is one hunk:

```json
{
  "id": "H0012",
  "file": "src/cli/parse.ts",
  "header": "@@ -40,7 +42,9 @@ export async function parseRun(",
  "tier": "read",
  "category": "logic"
}
```

Go down the file, correct `tier` where the seed is wrong, and add a
`category`. The category is what marks a row as judged: a row without one is
the model's own answer still, and the scorer leaves it out. Tiers:

| tier     | meaning                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `read`   | a reviewer must understand it, by the rules in the instructions' Attention tiers section |
| `skim`   | they may pass over it                                                                    |
| `either` | two careful reviewers could disagree; the scorer leaves it out rather than pick a side   |
| `proven` | whitespace or imports only, set by the import; the parser makes it skim whatever is said |

The category is free text, grouped by the scorer. Use the same few words
across cases, so the per-category table means something:

| category           | what the lines are                                                        |
| ------------------ | ------------------------------------------------------------------------- |
| `logic`            | behaviour: branches, error handling, the change's own work                |
| `types`            | declarations, interfaces, schemas, signatures                             |
| `test-case`        | a test's name, inputs or assertions, or the data a case builds for itself |
| `test-scaffolding` | setup and teardown hooks, shared fixtures, factories, mocks, helpers      |
| `call-sites`       | callers of a renamed or re-signed function, with nothing else in them     |
| `wiring`           | registration, exports, config, plumbing                                   |
| `docs`             | prose, comments, documentation                                            |
| `moved`            | a block lifted from or to another hunk                                    |

The contrived cases show one kind each, `moved` and `wiring` from the table
above and these, on the hunks that are that kind, with `read` where the trap
is:

| category       | what the lines are                                                                      |
| -------------- | --------------------------------------------------------------------------------------- |
| `logging`      | log lines, trace ids, counters; the parameters that carry them                          |
| `strings`      | translations: new keys for text the same change introduces, or a whole new locale       |
| `local-rename` | a local, a parameter or a private helper given a new name, unchanged                    |
| `changelog`    | a changelog or release-notes entry                                                      |
| `version-bump` | a version number: read, since one is rare and can carry more with it, as its trap shows |

A changed or removed string is `read`, since code may still show it. The
`version-bump` case is kept as a control, an ordinary feature with a bump
beside it, so a change to the rules is also measured on hunks that are no
kind at all.

A `note` on a row is for whoever reads the label next: why it is what it is.
The import leaves the model's own skim reason there.

## Running a sweep

```bash
npm run eval:skims -- run --samples 5
```

Every case, five samples each, one SDK query per sample. `--case <name>`
limits it; `--model` picks the model, `er`'s default otherwise; `--parallel`
sets how many queries run at once (three by default). Each sample costs about
what the change's diff costs to read once, ten to thirty cents on a typical
pull request, so a sweep of a few cases is a few dollars.

The run needs `ANTHROPIC_API_KEY` and refuses without it. A plan sign-in
would draw the whole sweep from the plan's allowance; a key from the Console
organisation linked to a Max plan spends the monthly API credit the plan
includes, which covers the Agent SDK and is lost at the end of each cycle
anyway. Create the key at platform.claude.com/settings/billing and export it
for the shell the sweep runs in.

Every answer is written under `evals/skims/results/<stamp>/`, which is
ignored by git, and scored at the end. Relabelling a case does not need a
new sweep:

```bash
npm run eval:skims -- score evals/skims/results/20261027-223015
```

## Reading the score

```
pr-38  Split a test file's hunks between its cases, never inside one
  37 hunks: 31 judged, 1 proven, 5 either, 0 unlabelled  ·  5 samples
  category            hunks             agree    skimmed read     read skim    missing
  logic                  10     96% (90%–100%)       0.2 (0–1)     0.2 (0–1)          0
  test-case               8     85% (75%–100%)       1.2 (0–2)             0          0
  …
  all                    31     89% (87%–92%)        1.4 (0–2)     2.0 (1–3)          0
  skim rate  model 48% (45%–52%)  ·  labels 42%
  wrong in 3+ of 5 samples:
    H0012  src/x.test.ts  @@ -40,7 +42,9 @@ describe(…  [test-case]  label read  ·  model skim ×4  “shared test fixtures”
```

Every figure is per sample, shown as the mean and, in brackets, the lowest
and highest sample. A change to the rules is real when it moves a figure
outside that bracket; inside it is the model's own variance.

The two kinds of error are kept apart on purpose. **Skimmed read** is a hunk
a reviewer had to read that the model faded, which hides the change; the
instructions say to choose `read` when unsure, so this is the figure to
drive down. **Read skim** is a hunk they could have passed over that the model
made them read, which costs a minute. One number for both would let a rule
trade the first for the second and look better for it.

The hunks listed at the end are the ones the model gets wrong in most
samples. They are where to look: a category that keeps appearing there is a
rule the instructions state badly, or do not state, or one that should become
a hint the tool proves rather than a judgement it asks for, the way whitespace
and imports already are.
