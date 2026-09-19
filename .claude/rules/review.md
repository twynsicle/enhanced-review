---
paths:
  - 'src/review/**'
---

# `src/review/` — what a review is

The shape of a review and the rules that judge one, read by `er` in Node and
by the report in the browser. So nothing here imports Node, the Agent SDK, a
UI package, `src/cli` or `src/report` (the `layering` guardrail); its one
package is Zod.

```
src/review/
  narrative.ts       NarrativeReview Zod schema + types; chapter.diagram? + overviewDiagram?;
                     ProseSchema — overviewSummary and chapter.description are a `{ lede, body? }`, the lede one
                     short sentence and the body Markdown, because one free-text field is what produced the
                     50-word sentences this replaced; Insight.filename? — the file an insight is about, drawn on
                     that diff card rather than above all of them; three insight types, not four — a pointer to
                     related code or docs is `context` with a link, which is what `reference` was;
                     JudgementCall / judgementCalls? / MAX_JUDGEMENT_CALLS — the questions only a human can
                     answer, review-wide rather than per chapter so the cap is review-wide too, and anchored
                     (filename + hunkIds both required) because a question is answerable only beside the lines
                     that raised it;
                     ReviewFile.skipped? — why a changed file was left out: generated, vendored, built-in, binary;
                     ReviewFile.hunks? — the file's share of the hunk catalog, so a stored review knows what was
                     reviewable and not only what was cited; SUMMARY_SECTION_ID / RISK_SECTION_ID, the reader's
                     synthesised sections
  findings.ts        Finding: code, severity, message and where it happened, plus the ONE map from code to
                     severity — fatal disqualifies the answer, warning ships and is shown, note is only recorded;
                     FindingLog, the collector the parsers write to; FindingSchema, since findings.json is read
                     back; runStoppedEarly/passedAfterRetry, the two findings a run earns by how it behaved
  validate-review.ts validateReview(text, grounding) → { review, findings }: the parse plus the coverage check,
                     and the one verdict the Stop hook and the parse stage both ask for; a hunk the prompt showed
                     that no chapter cites is fatal
  coverage.ts        what the chapters left out, per file: withFileHunks attaches the catalog to the
                     files at parse; reviewCoverage subtracts what the chapters cite, per hunk, and returns the
                     totals and byFile, one FileCoverage per catalogued file carrying its leftovers and their DiffChunk; plus chaptersCiting,
                     judgementCallOwner (the first chapter whose card for the call's file shows one of its hunks —
                     the parser and the reader must agree on it) and
                     citedChunk (every chapter's hunks for one file merged into a single chunk, deduplicated and in
                     file order, so the file view draws one diff rather than one per citing chapter); a file
                     without a catalog reports nothing. A shown hunk no chapter cites is fatal and `er` shows the
                     model every hunk, so a review that passed validation has no leftovers; the file view's label
                     for them and the sidebar's ○/◐ are what one would look like
  diagram.ts         Diagram Zod schema — 4 kinds over 2 structures: architecture/state/beforeAfter share one
                     node/edge graph, sequence is its own; per-node/edge change marks, optional file+hunk
                     grounding, DIAGRAM_LIMITS, hasUniformChange
  review-meta.ts     ReviewMeta: the report's summary header
  bundle.ts          ReviewBundle: a review + meta + both sides of each file, for rendering offline;
                     schemaVersion, no back-compat; parseBundle, filePair
  bundle-html.ts     the bundle as the text of the report's er-bundle element: injectBundle escapes every <,
                     readEmbeddedBundle
  language-map.ts    path → Monaco language id
  plural.ts
  prompt/            ai-file-filter (builtInSkipReason over lockfiles, bundles and snapshots, binarySkipReason;
                     `src/cli/skip-reasons.ts` layers the repository's own marks between them),
                     diff-hunk-catalog (H0001… ids; PromptGrounding/groundingFor, what a model's answer is
                     checked against),
                     instructions.ts (NARRATIVE_SYSTEM_PROMPT, the review instructions and output schema, and
                     LOCAL_WORKING_TREE, the closing paragraph saying where the agent is standing),
                     parse-narrative (lenient sanitising, validated by NarrativeReviewSchema; every repair it makes
                     is recorded as a Finding, so leniency is not silence; it assumes no pairing of the
                     <narrative_review> tags — opening tags are tried last to first, and for each one every closing
                     tag after it last to first, taking the first body that parses into a record with a string
                     prTitle and an array of chapters — since a run asked to answer again leaves more than one
                     block, the model then writes a sentence naming the tags, and an answer can quote either tag
                     inside its own JSON (a review of this repository does); when nothing qualifies it reports
                     against the last opening tag paired with the last closing tag after it;
                     a failed JSON.parse is
                     retried once with escapeStrayQuotes, which escapes a quote the model left unescaped inside a string;
                     fails the whole review — never silently drops or keeps a chapter — when a chapter ends up with no
                     diffChunks after hunk-id resolution and the prompt showed at least one hunk to cite, since prose
                     with nothing to show for it is a generation defect, not a valid review; a diff with nothing
                     reviewable at all is exempt, since then no chapter could have cited anything;
                     a judgement call is held to the chapters' own cited paths, not the change's file list, and
                     dropped whole — never hoisted — when its filename is not one of them or none of its hunk
                     ids resolve to that file, since it is drawn beside those lines or nowhere; it is drawn on
                     its judgementCallOwner's card (coverage.ts), so its hunk ids are narrowed to the ones that
                     card shows, and the reader picks the owner the same way; the cap is
                     applied here rather than by the schema, which could only refuse the whole review;
                     sanitizeProse takes a `{ lede, body? }` object or a bare string, which is promoted to the
                     lede, as is a body that arrived without one; a chapter's diffChunks are merged to one per
                     filename, since the reader keys a file's insights and its count on the name; and an insight's
                     `filename` survives only when the chapter's own diffChunks cite it — anchored elsewhere it
                     would be drawn nowhere, so the anchor goes and the insight stays),
                     parse-diagram (same leniency for diagrams, and the same record of it: drops the invalid part,
                     validates each diagram on its own
                     so a bad picture cannot fail the review; a node's filename checked against the reviewed file
                     list and its hunk ids against the hunks the prompt showed),
```

## How a review runs

- **Validation**: every answer is judged by `validateReview`, and what it
  found travels with the review (`findings.ts` states the severity of each
  finding in one place). A disqualifying finding — an unreadable answer, a
  missing field, a chapter with no hunk of its own, a hunk no chapter cites, a
  run that stopped early — refuses the model's stop and names the defect, up
  to three times; what survives that fails the review outright, because a
  review with a hole in it that looks finished is worse than no review. A
  warning ships with the review and is shown to whoever ran it; a note is only
  recorded.
