---
paths:
  - 'src/domain/**'
---

# `src/domain/` — the review model shared by `er` and the report

Loaded when you open a domain file. `domain` is
shared between Node (`er`) and the browser (the report); `*.server.ts` marks the Node-only modules
(the rule is in `AGENTS.md` under Layering).

```
src/domain/
  github/            types.ts
  review/            shared: narrative.ts (NarrativeReview Zod schema + types; chapter.diagram? + overviewDiagram?;
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
                     synthesised sections),
                     findings.ts (Finding: code, severity, message and where it happened, plus the ONE map from
                     code to severity — fatal disqualifies the answer, warning ships and is shown, note is only
                     recorded; FindingLog, the collector the parsers write to; FindingSchema, since findings are
                     read back; runStoppedEarly/passedAfterRetry, the two findings
                     a run earns by how it behaved),
                     validate-review.ts (validateReview(text, grounding) → { review, findings }: the parse plus the
                     coverage check, and the one verdict the Stop hook and `er` both ask for;
                     a hunk the prompt showed that no chapter cites is fatal),
                     coverage.ts (what the chapters left out, per file: withFileHunks attaches the catalog to the
                     files at parse; reviewCoverage subtracts what
                     the chapters cite, per hunk, and returns the totals and byFile, one FileCoverage per
                     catalogued file carrying its leftovers and their DiffChunk; plus chaptersCiting,
                     judgementCallOwner (the first chapter whose card for the call's file shows one of its hunks —
                     the parser and the reader must agree on it) and
                     citedChunk (every chapter's hunks for one file merged into a single chunk, deduplicated and in
                     file order, so the file view draws one diff rather than one per citing chapter); a file
                     without a catalog reports nothing. A shown hunk no chapter cites is fatal, so leftovers
                     survive only where the prompt was truncated — which is why the file view draws them under their
                     own label and the reader has no separate "Not discussed" section),
                     diagram.ts (Diagram Zod schema — 4 kinds over 2 structures: architecture/state/beforeAfter share one
                     node/edge graph, sequence is its own; per-node/edge change marks, optional file+hunk grounding,
                     DIAGRAM_LIMITS, hasUniformChange), target.ts (ReviewTarget schema, describeTarget),
                     review-meta.ts (ReviewMeta: the reader's summary header; reviewMetaFromJob for hosted jobs),
                     skip-reasons.server.ts (why each changed file is left out: the built-in
                     list, then the reviewed repository's own `.gitattributes` — `git check-attr` at the head commit,
                     which resolves a nested `.gitattributes` for the paths beneath it — then binary; the git call is
                     injected;
                     toReviewFiles stamps the reasons onto the changed files a review stores),
                     bundle.ts (ReviewBundle: a review + meta + both sides of each file, for offline rendering;
                     schemaVersion, no back-compat; parseBundle, filePair), bundle-html.ts (the bundle as the text of
                     the report's er-bundle element: injectBundle escapes every <, readEmbeddedBundle),
                     language-map.ts, inline-diff-snippets.ts (reader maths)
    clone/           *.server.ts: git-runner (spawn, non-interactive, the host's system and global gitconfig ignored
                     unless a call asks for `hostConfig`, abort → SIGTERM; argBatches, the path-list split that keeps a
                     command line inside Windows' limit),
                     diff-files (listChangedFileDetails/parseChangedFiles: per-file counts joined to statuses over
                     `-z` output under the same diff pins, each rename's old path and the binary flag; output that
                     ends mid-record throws rather than yielding a short list)
    prompt/          pure: ai-file-filter (the rules that need no repository to state them — builtInSkipReason over
                     lockfiles, bundles and snapshots, binarySkipReason; skip-reasons.server.ts layers the
                     repository's own marks between them),
                     diff-hunk-catalog (H0001… ids; PromptGrounding/groundingFor, what a model's answer is
                     checked against), narrative-prompt (system + user; the prompt reviews exactly the files
                     carrying no `skipped` reason, drops the patch of anything the built-in rules match even
                     when the file list missed it, and lists the rest under Not Reviewed; hunk ids are numbered
                     over the whole filtered diff, so ids mean the same thing to the coverage check, and the
                     result carries both `catalog`, every hunk, for coverage, and `grounding`, which resolves only
                     the hunks the truncated prompt showed while knowing every reviewed file's name;
                     NARRATIVE_SYSTEM_PROMPT, formatFileList, formatHunkCatalog and formatSkippedSection are
                     shared with the local CLI's prompt),
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
                     list and its hunk ids against the hunks the prompt showed), types.ts (PrData),
                     instructions.ts (the review instructions and output schema, shared with the local CLI, plus one
                     closing paragraph per path: SERVER_WORKING_TREE, LOCAL_WORKING_TREE; the assembled server prompt is
                     pinned byte-for-byte by __fixtures__/server-prompt.txt)
    executor/        validation-stop-hook.server.ts (the retry, as a Stop hook: validates the text accumulated so far
                     and refuses the stop up to MAX_VALIDATION_RETRIES times, naming the defect and asking for the
                     whole block again — without spelling the tag pair, which the parser would then find; onBlock
                     gets the defects apart from the whole reason sent to the model, and onError allows the stop
                     when the hook itself throws rather than stranding the run; SDK types only, so `er` can share it);
                     sdk-loop.server.ts (the message loop the local CLI runs on: text, tool uses and the
                     result out — subtype, turns, cost and token usage, cost counted even when the run ran out of
                     turns — nothing thrown: each caller decides what a failure means; plus howItEnded, the one
                     reading of a result)
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
