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
                     ProseSchema — overviewSummary is a `{ lede, body? }`, the lede one short sentence and the
                     body Markdown, because one free-text field is what produced the 50-word sentences this
                     replaced; a chapter is `title` (the label lists show), `headline` (required, the one
                     sentence its card opens on) and `body?` (Markdown) — the headline its own field so that no
                     overview style can restyle or drop it; Insight.filename? — the file an insight is about, drawn on
                     that diff card rather than above all of them; three insight types, not four — a pointer to
                     related code or docs is `context` with a link, which is what `reference` was;
                     JudgementCall / judgementCalls? / MAX_JUDGEMENT_CALLS — the questions only a human can
                     answer, review-wide rather than per chapter so the cap is review-wide too, and anchored
                     (filename + hunkIds both required) because a question is answerable only beside the lines
                     that raised it;
                     ReviewFile.skipped? — why a changed file was left out: generated, vendored, built-in, binary;
                     ReviewFile.hunks? — the file's share of the hunk catalog, so a stored review knows what was
                     reviewable and not only what was cited; HunkFacts (whitespaceOnly?, importsOnly?, movedFrom?/movedTo? —
                     what the CLI proved, carried on every ResolvedDiffHunk; provenSkim, the facts that settle a
                     hunk as skim — whitespace and imports — which the parser and the stub both ask); ResolvedDiffHunk.part? (which part
                     of a split hunk it is, from its header, for the reader's hunk debug); .changedLines, the
                     lines it adds and removes without git's context, what the reader times; a whitespace-only or imports-only hunk is skim
                     whatever the model said, a move only a hint; DiffChunk.hunks is
                     CitedHunk[], a resolved hunk plus its HunkTier (read | skim, the model's call on how hard to
                     look; nothing folds, and the reader can fade skim lines in place) and, on a skim hunk only,
                     skimReason, the model's few words on why, which the reader labels the lines with;
                     the order of `chapters` is the reading order, a cause before its consequences, with no
                     field for it; ReadingPlan / readingPlan? — `brief` (the one to three chapters where the
                     risk is, and the only mark of a core chapter) within `standard` (what approving needs),
                     chapter ids in chapter order; full is every chapter and has no field, and no minutes are
                     stored, since the reader computes them; ContextExcerpt / chapter.contextExcerpts? —
                     unchanged code the chapter's change reaches without editing it (a caller, a subclass, a
                     contract, a definition the diff hides), at most MAX_CONTEXT_EXCERPTS (2) a chapter of at
                     most MAX_EXCERPT_LINES (60) lines each, 1-based and inclusive at the head commit, never a
                     file the change touches;
                     SUMMARY_SECTION_ID / RISK_SECTION_ID, the reader's synthesised sections
  findings.ts        Finding: code, severity, message and where it happened, plus the ONE map from code to
                     severity — fatal disqualifies the answer, warning ships and is shown, note is only recorded;
                     FindingLog, the collector the parsers write to; FindingSchema, since findings.json is read
                     back; runStoppedEarly/passedAfterRetry, the two findings a run earns by how it behaved;
                     excerptsDropped, the one `excerpt-dropped` warning a check writes, naming each excerpt it
                     dropped and why — the parser and the parse stage each write their own
  validate-review.ts validateReview(text, grounding) → { review, findings }: the parse plus the coverage check,
                     and the one verdict the Stop hook and the parse stage both ask for; a hunk the prompt showed
                     that no chapter cites is fatal
  coverage.ts        what the chapters left out, per file: withFileHunks attaches the catalog to the
                     files at parse; reviewCoverage subtracts what the chapters cite, per hunk, and returns the
                     totals and byFile, one FileCoverage per catalogued file carrying its leftovers and their DiffChunk; plus chaptersCiting,
                     judgementCallOwner (the first chapter whose card for the call's file shows one of its hunks —
                     the parser and the reader must agree on it),
                     mergeCitations (one hunk cited twice: read wins over skim, two skims keep the first reason;
                     asRead, a hunk raised to read without its skim reason) and
                     citedChunk (every chapter's hunks for one file merged into a single chunk, deduplicated by
                     mergeCitations and in file order, so the file view draws one diff rather than one per citing
                     chapter); a leftover chunk's hunks are `read`, since no chapter judged them; a file
                     without a catalog reports nothing. A shown hunk no chapter cites is fatal and `er` shows the
                     model every hunk, so a review that passed validation has no leftovers; the file view's label
                     for them and the sidebar's ○/◐ are what one would look like
  diagram.ts         Diagram Zod schema — 4 kinds over 2 structures: architecture/state/beforeAfter share one
                     node/edge graph, sequence is its own; per-node/edge change marks, optional file+hunk
                     grounding, DIAGRAM_LIMITS, hasUniformChange
  review-meta.ts     ReviewMeta: the report's summary header, what kind of review it is (pr, branch or staged, so
                     the reader never guesses it from a ref's name), and the base and head commits the reader keys
                     a reader's progress on
  bundle.ts          ReviewBundle: a review + meta + both sides of each file, for rendering offline — each
                     reviewed file, and each file an excerpt shows as its head side alone, blank outside the
                     excerpted lines; the
                     changed files are review.files, never the keys of `files`; schemaVersion, no back-compat;
                     parseBundle, filePair
  bundle-html.ts     the bundle as the text of the report's er-bundle element: injectBundle escapes every <,
                     readEmbeddedBundle
  language-map.ts    path → Monaco language id, which hunk-facts also reads for whether indentation is syntax
  plural.ts
  test-file.ts       isTestFile: a path named or placed as a test by the common conventions, which the
                     splitter cuts by its test blocks and the chapter card lists after the code it tests
  prompt/            ai-file-filter (builtInSkipReason over lockfiles, bundles and snapshots, binarySkipReason;
                     `src/cli/skip-reasons.ts` layers the repository's own marks between them),
                     diff-hunk-catalog (H0001… ids, each hunk's changedLines counted off its body;
                     PromptGrounding/groundingFor, what a model's answer is
                     checked against, `changed` being every path the change touches, skipped files included; toResolvedHunk, a catalog hunk as a review stores it, facts and split part kept),
                     hunk-facts (hunkLines reads each hunk's removed and added lines in catalog order, each with its
                     line number on its own side;
                     provenFacts, handed the hunks and each file's two sides as text (null where gather embedded
                     none): importsOnly when a TypeScript or JavaScript hunk changes a line that is not blank and
                     every such line is import wiring on its own side, read off the whole file by import-lines; whitespaceOnly when the two sides match with whitespace outside a string literal
                     cut to what can change a parse — one space between two characters that could fuse (two
                     words, or any two operator characters: `+ +`, `< -`, `= >`), one line break after a line
                     comment, or straight after a word, a closing bracket or a closing quote unless a closing
                     bracket follows (semicolon insertion, and Go, Ruby, Kotlin and Swift ending a statement at
                     the line), every other run gone; a chain rewrapped after `)` goes unproven — and where indentation is
                     syntax (Python, YAML, Markdown, makefiles…) each line keeps its own indentation too; movedFrom/movedTo between a hunk that only adds and
                     one that only removes, when the significant lines they share, as a multiset, are at least 80%
                     of each side and include three distinct distinctive ones (8+ characters with a word that is
                     not a keyword or markup filler), similarity the smaller share and 100 only for a block
                     moved unchanged (in order, each line whole but for a margin the block shifted by as a
                     whole, in the same whitespace character), best overlap winning and the
                     removing hunk naming its best destination; any file, never a hunk that edits in place; facts
                     are hints for the tier and tags in the reader, and whitespace or imports only settle it; each
                     errs toward proving nothing, since a fact can fade a hunk the model called read),
                     import-lines (importLines: the 1-based lines of a script file that are a top-level import,
                     side-effect import or `export … from`, each over every line it is written on — read off the
                     whole file, since a member a hunk adds to a long import list says nothing alone; no parser,
                     but a scan for where each line starts, in code at bracket depth 0 or inside a string,
                     comment or template, so an import in a fixture's template is never one; a statement must
                     match whole with nothing after it on its line but `;`, an attribute or a line comment, and
                     every miss leaves a hunk unproven rather than proven wrongly; isScriptFile),
                     split-hunks (splitPatch: one file's patch with each hunk over the target rewritten as parts,
                     each a real hunk with a synthesised `@@ … @@ (part k of n)` header, so nothing downstream
                     needs to know a part from a hunk; a hunk's body is delimited by its header's counts, an
                     empty line in it a blank context line (git's diff.suppressBlankEmpty), and a body that
                     does not match them throws; cut where a paragraph opens at the shallowest indentation in
                     range, a block still over the target cut again one level in, never inside a run of changed
                     lines that both removes and adds, then packed greedily up to the target, a part of three or
                     fewer non-blank changed lines (a function's `return` and closing bracket, typically) joined
                     to its neighbour past the target, since alone it is tiered by its bracket; in a script's test
                     file (isScriptFile and isTestFile) a part may also open at a suite, case or hook line
                     (describe/it/test and the rest, modifiers included), never inside a case or hook — one over
                     the target stays whole — nor straight after a suite's opening line, which goes with
                     whatever follows it, its setup or its first case, so a `describe(` is never a part of its own; a block ends at the next line no deeper than its
                     opener, measured on the opener's own side; a hunk that starts mid-case has no opener to go
                     by and is cut by paragraphs; splitPart reads a header's part number back),
                     instructions.ts (NARRATIVE_SYSTEM_PROMPT, the review instructions and output schema, and
                     LOCAL_WORKING_TREE, the closing paragraph saying where the agent is standing),
                     overview-styles (OVERVIEW_STYLES, the names --overview-style takes and er validates against,
                     and OVERVIEW_STYLE_TEXT, each one's instruction for the overview's and the chapters' bodies —
                     narrative, the default, has none; overviewStyleSection, the prompt.md section saying the
                     body is restyled and nothing else is: the overview's lede and every chapter's headline stay
                     one sentence, every chapter keeps its headline, the JSON is unchanged),
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
                     a chapter id is unique once sanitised (chapterIds) — every id the model gave is reserved
                     first, so a made-up one never takes a later chapter's; a missing one becomes the first free
                     `chapter-<n>` or `chapter-<n>-<k>` (a note), and a real repeat, of an earlier chapter's id or
                     a reader section's (SUMMARY_SECTION_ID, RISK_SECTION_ID), is replaced the same way, in a
                     `chapter-id-duplicate` warning, the first holder keeping it, since the plan, the sidebar,
                     progress and Next all key on it;
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
                     sanitizeProse takes the overview's `{ lede, body? }` object or a bare string, which is
                     promoted to the lede, as is a body that arrived without one; a chapter with no headline (absent,
                     blank or not a string) is a fatal `chapter-no-headline`, every such chapter named before the
                     review fails, so one retry mends them all — never a heading made up from the title; a
                     chapter's body is kept trimmed when it is a non-blank string and otherwise left out, a
                     `prose-dropped` note when one arrived; a headline past MAX_HEADLINE_WORDS (the prompt's
                     limit, which the instructions and the style section interpolate) is kept as written, in a
                     `headline-long` note; a diffChunk's `hunks` entry may arrive as a bare
                     id string; a whitespace-only or imports-only hunk is skim whatever tier came with it (a `read` there is
                     one `hunk-tier-lowered` note naming the hunks), and otherwise a
                     missing or unknown tier is read as `read` — leniency toward the model, recorded once per
                     review as a `hunk-tier-missing` warning naming the hunks, never a reason to fail; a
                     skimReason is kept trimmed on a skim hunk and dropped on a read one, when blank, or past
                     MAX_SKIM_REASON characters, the last in one `skim-reason-dropped` note, since it is drawn
                     as a label over the code;
                     every hunk a judgement call cites is raised to `read` on its owner's card, in one
                     `hunk-tier-raised` note, since a question must not sit on lines faded as skim; a chapter's diffChunks are merged to one per filename (a hunk in both through
                     mergeCitations), since the reader keys a file's insights and its count on the name; and an insight's
                     `filename` survives only when the chapter's own diffChunks cite it — anchored elsewhere it
                     would be drawn nowhere, so the anchor goes and the insight stays; the reading plan keeps
                     each list's real chapter ids once each, in chapter order, dropping the rest in one
                     `reading-plan-id-dropped` note, widens `standard` to hold `brief` (a
                     `reading-plan-widened` note), and is dropped — a `reading-plan-dropped` warning, the review
                     shipping without one — when it is missing, not an object, or has no brief left; a review
                     with no chapters has nothing to plan and is not warned; an excerpt of unchanged code is
                     dropped whole, never trimmed, when it names no file or no plain path from the repository
                     root (absolute, `..`, a backslash — git would fail the stage on it), its lines are not whole numbers from
                     1, its span runs backwards or past MAX_EXCERPT_LINES, it gives no reason, or it names a
                     path in `changed`, and past the first two that pass; every drop across the review goes in
                     one `excerpt-dropped` warning; whether the file and span exist is the parse stage's to
                     check, since only git knows),
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
