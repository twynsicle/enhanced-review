---
paths:
  - 'src/evals/**'
  - 'evals/**'
---

# `src/evals/` — the skim and diagram evals

Two measurements of the model, each on cases made for it, so that a change
to one section of the review instructions can be compared before and after
on the same changes: the **skim eval**, how well the model tiers hunks
against a person's labels (`docs/skim-evals.md`), and the **diagram eval**,
whether it draws the diagram a change deserves and nothing when it deserves
none (`docs/diagram-evals.md`). Both run the model the way the CLI does
(`cli → review` plumbing, the SDK loaded only by a real sweep), so the
`layering` guardrail allows `evals → evals, cli, review`, plus `report` for
the diagram eval's contact sheet data shape (`src/report/sheet/sheet-data.ts`),
and nothing imports `evals`. Neither is part of the gate: a sweep spends money.

```
src/evals/
  contrive.ts      shared by both evals: BranchSpecSchema (branch.json: branch, title, description, commit,
                   removed paths), parseBranchSpec through whichever spec schema an eval keeps, listBranches (every
                   directory under a contrived dir but base), layBranch (files/ copied whole over the tree,
                   removed paths deleted), ModelRepo (a base tree, the working clone's name, the import
                   commit's subject and a fixed author, so two builds make the same commits),
                   withContrivedBranch (the base stood up in a temp directory as main of a working clone with
                   a bare origin whose HEAD is set, since a branch review measures from origin's default
                   branch; the branch laid over it and committed; the tree handed to the caller and removed
                   after, however the caller ends), stubReview (`er review --stub --no-open` through this
                   checkout's bin)
  skims.ts         the bin, `npm run eval:skims -- <import|recut|contrive|run|score|score-runs>`, run from this repository's root
  skim-case.ts     SkimCase (case.json: title, description, commits, files, the hunk catalog, where it came
                   from), Label (labels.jsonl, one JSON object per line: id, file, header, tier, category?,
                   note?) and LabelTier (read | skim | either | proven); caseFiles / readCase / writeCase /
                   listCases, readCase refusing labels that do not name the catalog's hunks once each; a row
                   is a label only once it carries a category, since the import seeds the tier from the model;
                   catalogDigest, a fingerprint of the hunks a case names, which a sweep stores beside its answers
  skim-import.ts   importCase: a run folder's context.json (through the CLI's RunContextSchema, so an older
                   run that no longer fits it is refused, not patched), its diff.patch, and its review's
                   tiers into a case; seedLabels: `proven` where provenSkim says so, else the review's
                   tier, else `read`, the model's skim reason kept as the note; refuses to overwrite a case,
                   since labels are hand work; defaultCaseName, the run folder's slug; ImportOverrides, the
                   title, description and source folder a contrived run has no pull request to supply;
                   recutCase: a real case cut again from a newer run of its change, since a splitter change
                   leaves older cases naming hunks the tool no longer cuts; carryLabels keeps each judgement on
                   the new hunk with the same file and lines (hunkBodies, each hunk's text off its marker line,
                   its part tag left out so a renumbered part still matches) and leaves the rest seeded
  skim-contrive.ts contriveCase: a branch under evals/skims/contrived stood up over stockline (stocklineRepo,
                   the ModelRepo) through withContrivedBranch, `er review --stub --no-open` run there, and the
                   run imported as the case; listContrived, every branch but the base
  skim-review.ts   a whole er run's tiers: readReviewTiers (review.json read for the chapters' cited hunk ids
                   and tiers alone), citedTiers (read wins over skim across chapters, as the parser merges),
                   readRunAnswer / runAnswer, a run as one sample of a case for `score-runs`, refused unless
                   the run numbered the same hunks, file and header, as the case's catalog
  skim-prompt.ts   SKIM_SYSTEM_PROMPT: the role sentence, ATTENTION_TIERS verbatim from instructions.ts (the
                   one text, so the eval cannot drift from the review), and a <hunk_tiers> output schema
                   asking for tiers alone; buildSkimPrompt: the change as prompt.ts formats it (commits, file
                   list, Not Reviewed, the hunk catalog with its hints) with the diff inlined, since the run
                   has no tools and no working tree
  skim-answer.ts   parseTierAnswer: the last <hunk_tiers> block, read strictly — a tier that is not read or
                   skim, a missing id, a duplicate, a read hunk with a reason or a skim hunk without one is a
                   problem on the record and no tier, where the review's parser would be lenient, because an
                   eval has to count what the model actually said
  skim-run.ts      runSweep: every case × samples through runSdkLoop with no tools, one turn, no setting
                   sources and the SKIM_SYSTEM_PROMPT, `parallel` queries at once (mapLimit), each answer
                   written to results/<stamp>/<case>/sample-<n>.txt with its cost and ending beside it, and
                   run.json for the sweep, each case's catalogDigest in it so `score` refuses a case recut
                   since; requireApiKey, which refuses a sweep without ANTHROPIC_API_KEY so
                   it spends API credit and never a plan sign-in; readSweep, the record and every answer
                   parsed back for scoring; an SDK error fails the sweep rather than scoring a silence
  skim-score.ts    scoreSample / scoreCase over judged labels (tier read or skim, with a category): agreed,
                   skimmedRead (labelled read, model skim — the error that hides the change), readSkim (the
                   error that wastes a minute) and missing, in total and per category, the model's skim rate
                   against the labels', reasons past MAX_SKIM_REASON, and the hunks wrong in at least half the
                   samples with every reason the model gave; spread, `mean (min–max)` across samples;
                   formatCaseScore / formatOverall, the latter pooling the cases sample by sample so the
                   spread is still across runs of one prompt
  diagrams.ts      the bin, `npm run eval:diagrams -- <contrive|run|score|sheet|judge|agree>`, run from this
                   repository's root: contrive, the base's tests, then each branch stood up, tested,
                   stub-reviewed and sized; run, a sweep (requireApiKey first) then its score; score, the score
                   again with each judge's ratings once the sweep is judged, written to score.txt; sheet, the
                   contact sheet of one sweep or two; judge, the judges over the sweep's overviews
                   (requireApiKey first) then the score; agree, the user's ratings against each judge's and
                   the judges against each other
  diagram-case.ts  DiagramBranchSpecSchema, the shared spec plus `expect` (ExpectSchema: overview, the kinds
                   an overview may be or null for none; chapterDiagrams, a min–max count and the kinds, max 0
                   the control; mustName, the mechanisms the overview should name, prose for the eye and
                   later a judge; mustReach, the untouched files a mechanism map should ground, or a `/`-ended
                   folder a part spanning several files should be grounded in whole; question,
                   what the overview alone should answer), kinds held to DiagramKindSchema; readDiagramSpec,
                   listDiagramBranches, packhouseRepo (the ModelRepo); GIVEAWAY and giveaways, the words
                   that would tell the model what a branch is for, found in the spec's prose or any file it
                   lays down, `diagram` among them since a change that names its own picture has not made
                   the model choose it
  diagram-run.ts   runDiagramSweep: every branch × samples, each a whole
                   `er review --no-open --diagram-style <style> [--model]` (erReview,
                   this checkout's bin as a subprocess) on the branch stood up afresh, `parallel` at once, the
                   run folder copied out before the tree goes; exit 0 and WARNED both a written review, any
                   other exit or no run folder a failed sample with the tail of er's output; cost and turns
                   off the run's result event; run.json (DiagramSweepSchema) carries each branch's digest;
                   readDiagramSweep, readDiagramSample, diagramSampleFiles
  diagram-score.ts scoreDiagramSweep, refused when a branch's digest moved since the sweep; scoreReview, a
                   review's diagrams against `expect` (overview present and of an allowed kind or absent when
                   none deserved, chapter diagrams within min–max and of the allowed kinds, onTarget when
                   both), diagramStats per diagram (nodes — a sequence's participants — unchanged, identifier
                   labels by isIdentifierLabel's code-shaped-word test, labelled edges — every message of a
                   sequence, nested groups included — grounding filenames and every text it shows), mustReach
                   paths reached (a folder grounding reaching every file under it), missed (fewer diagrams
                   than deserved), diagram drops and a retry from findings.json; findEchoes, the diagram text
                   that copies a quoted example of the run's own prompt.md (examplePhrases) or carries an
                   example's word the branch's files and description never use, words stemmed; the one-line formatters (deserved,
                   sampleVerdict, sampleFigures) the bin and the sheet share; formatBranchScore and
                   formatDiagramOverall, the skim eval's `mean (min–max)` spread across samples
  diagram-judge.ts the rubric judge: DEFAULT_JUDGES (Opus and Sonnet, since the drawing model may favour its
                   own work); describeDiagram, an overview as text (a node a line with kind, change, path and
                   group, an edge a line by its ends' labels), never the rendered picture; JUDGE_SYSTEM_PROMPT
                   (answer the question from the picture first, then each mechanism yes / partly / no, then
                   the RUBRIC's good / usable / poor with a reason, in one <diagram_judgement> block);
                   buildJudgePrompt (the change's title and description, the question, the mechanisms, the
                   overview); parseJudgement, strict as the skim answer is, anything short of a clean verdict
                   a problem and no judgement; overviews, each scored sample's overview; runJudge, every
                   judge × overview through runSdkLoop with no tools and one turn, under <sweep>/judgements/
                   <model>/<branch>/sample-<n>.txt|.json with judgements.json, replacing an earlier judging;
                   readJudgements, an unjudged sweep being none; formatJudged, each judge's counts and the
                   share of mechanisms it found shown, partly shown and missing
  diagram-agree.ts the judges against each other, the check on the measure, and against the user, who rates how
                   an overview reads rather than whether it is right: readUserRatings (the sweep's ratings.json, the
                   sheet's download, filtered to the sweep's stamp), judgeRatings / judgeReasons, agreement
                   (exact, within one step, Cohen's kappa — undefined when chance alone agrees on all — and
                   each disagreement), formatAgreement with the judge's reason beside each
  diagram-sheet.ts writeContactSheet: one sweep or two scored, contactSheet (a row per branch with what it
                   deserves, a band per sweep, each sample's verdict, figures, diagrams with each judge's
                   verdict on the overview, and its review.html as a link relative to the sheet), injected into the sheet page vite.sheet.config.ts builds on
                   every call (vite's own build, loaded only then), written into the later sweep's folder
  diagram-contrive.ts contriveDiagramBranch: refuses a branch that gives itself away, stands it up over
                   packhouse, runs the service's own tests on the tree (runTests: `node --test` with the
                   pattern Node expands itself, no shell and no install) and a stub review, and reports
                   ChangeSize (reviewed files, hunks, the diff's added and removed lines; changeSize); nothing
                   is kept, since the branch is the case and a sweep stands it up again
evals/skims/
  cases/<name>/    case.json, diff.patch, labels.jsonl — committed, cut from merged pull requests or built
                   from a contrived branch
  contrived/base/  stockline, the small service every skim branch starts from
  contrived/<name>/ branch.json (branch, title, description, commit, removed paths) and files/, the files the
                   branch changes or adds, whole; one branch per kind of skim, with traps — see docs/skim-evals.md
  results/<stamp>/ one sweep's answers and summary.json — ignored by git
  vocabulary.json  stockline's names and domain nouns, for the eval-vocabulary guardrail
evals/diagrams/
  contrived/base/  packhouse, the order service every diagram branch starts from: wide and shallow, three
                   externals, a store, a queue and worker, a scheduler, HTTP and an ops CLI, no dependencies
  contrived/<name>/ branch.json (the skim spec plus `expect`) and files/; one branch per picture, a control
                   that deserves none, and a mixed change — see docs/diagram-evals.md
  results/<stamp>/ one sweep — ignored by git: run.json (the model, effort and diagram style with the rest), <branch>/sample-<n>.json (how er exited, cost,
                   the failure) and <branch>/sample-<n>/ (the whole run folder), score.txt, sheet.html,
                   judgements/ (the judges' answers) and ratings.json (the user's, saved from the sheet)
  vocabulary.json  packhouse's names and domain nouns, for the eval-vocabulary guardrail
```

- The skim categories the docs recommend are free text here, grouped as
  written; the scorer never validates them against a list.
- The skim eval reproduces the tiering question, not the review: the full
  run decides its chapters before it tiers, and the eval has no chapters.
  Confirm a change to the rules with a few real runs once the sweep says it
  helps. The diagram eval runs whole reviews for the opposite reason:
  whether a diagram is drawn at all is decided while the model chapters the
  change.
- The review prompt is never written against the cases. Its examples come
  from a domain no eval uses, and a miss a sweep shows is fixed by a rule
  that would hold for a change outside the eval set, in none of the case's
  words, or left alone. The `eval-vocabulary` guardrail catches the case's
  paths, exported names, routes and the nouns in each `vocabulary.json`; a
  rule shaped to one case has no word to catch. A model system a new eval
  adds gets its own `vocabulary.json`, and its eval directory goes in the
  guardrail's `EVALS`.
