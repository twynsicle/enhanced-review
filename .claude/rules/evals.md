---
paths:
  - 'src/evals/**'
  - 'evals/**'
---

# `src/evals/` — the skim eval

How well the model tiers hunks, measured on labelled cases, so that a change
to the Attention tiers section of the review instructions can be compared
before and after on the same changes. `docs/skim-evals.md` is the guide to
running and labelling; this is the map. It runs the model the way the CLI
does (`cli → review` plumbing, the SDK loaded only by a real sweep), so the
`layering` guardrail allows `evals → evals, cli, review` and nothing imports
`evals`. Not part of the gate: a sweep spends money.

```
src/evals/
  skims.ts         the bin, `npm run eval:skims -- <import|contrive|run|score>`, run from this repository's root
  skim-case.ts     SkimCase (case.json: title, description, commits, files, the hunk catalog, where it came
                   from), Label (labels.jsonl, one JSON object per line: id, file, header, tier, category?,
                   note?) and LabelTier (read | skim | either | proven); caseFiles / readCase / writeCase /
                   listCases, readCase refusing labels that do not name the catalog's hunks once each; a row
                   is a label only once it carries a category, since the import seeds the tier from the model
  skim-import.ts   importCase: a run folder's context.json (through the CLI's RunContextSchema, so an older
                   run that no longer fits it is refused, not patched), its diff.patch, and its review.json
                   read through SeedReviewSchema — only the chapters' cited hunk ids and tiers, which is all
                   the seed needs — into a case; seedLabels: `proven` where provenSkim says so, else the
                   review's tier (read wins over skim across chapters, as the parser merges), else `read`,
                   the model's skim reason kept as the note; refuses to overwrite a case, since labels are
                   hand work; defaultCaseName, the run folder's slug; ImportOverrides, the title, description
                   and source folder a contrived run has no pull request to supply
  contrive.ts      contriveCase: a branch under evals/skims/contrived stood up as a throwaway repository (the
                   base tree pushed to a bare origin with its HEAD set, since a branch review measures from
                   origin's default branch; a fixed author, so a rebuild makes the same commits), the branch's
                   files laid over it and its removals applied, `er review --stub --no-open` run there through
                   this checkout's bin, and the run imported as the case; BranchSpecSchema (branch.json);
                   listContrived, every branch but the base
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
                   run.json for the sweep; requireApiKey, which refuses a sweep without ANTHROPIC_API_KEY so
                   it spends API credit and never a plan sign-in; readSweep, the record and every answer
                   parsed back for scoring; an SDK error fails the sweep rather than scoring a silence
  skim-score.ts    scoreSample / scoreCase over judged labels (tier read or skim, with a category): agreed,
                   skimmedRead (labelled read, model skim — the error that hides the change), readSkim (the
                   error that wastes a minute) and missing, in total and per category, the model's skim rate
                   against the labels', reasons past MAX_SKIM_REASON, and the hunks wrong in at least half the
                   samples with every reason the model gave; spread, `mean (min–max)` across samples;
                   formatCaseScore / formatOverall, the latter pooling the cases sample by sample so the
                   spread is still across runs of one prompt
evals/skims/
  cases/<name>/    case.json, diff.patch, labels.jsonl — committed, cut from merged pull requests or built
                   from a contrived branch
  contrived/base/  the small service every contrived branch starts from
  contrived/<name>/ branch.json (branch, title, description, commit, removed paths) and files/, the files the
                   branch changes or adds, whole; one branch per kind of skim, with traps — see docs/skim-evals.md
  results/<stamp>/ one sweep's answers and summary.json — ignored by git
```

- The categories the docs recommend are free text here, grouped as written;
  the scorer never validates them against a list.
- The eval reproduces the tiering question, not the review: the full run
  decides its chapters before it tiers, and the eval has no chapters. Confirm
  a change to the rules with a few real runs once the sweep says it helps.
