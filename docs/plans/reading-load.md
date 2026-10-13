# Reading load — plan of plans (ER-48)

One branch, one PR, one commit per phase. Each phase gets its own just-in-time
plan before any code; this file fixes the shape, the order and the decisions
that cut across phases. Deleted when the work lands.

## Goal

A reader of a review should be able to spend less than full attention on most
of a change and know they have not missed anything: the review tells them
where to look hard, lets them fold what is mechanical, keeps track of what they
have read, and tells them what to do next. Nothing is hidden from a reader who
wants it; everything is still cited, still one click away.

## Decisions that hold across phases

- **Hunk ids stay flat.** A split hunk's parts are numbered into the same
  `H0001…` sequence as every other hunk, in file order. Nothing in the model's
  answer or the reader keys on the git hunk a part came from, so a dotted
  sub-id would be structure nobody reads. The catalog shown to the model names
  the parts as "part 2 of 3 of one git hunk" so it knows they were split.
- **The reader folds; the CLI and the model tag.** The CLI records facts it
  can prove about a hunk (whitespace-only, moved from another file). The model
  assigns the attention tier. The reader's fold follows the tier, and draws the
  facts as badges. Neither the CLI nor the parser ever hides a hunk.
- **Tier is required on every cited hunk.** A citation without one is repaired
  to `read` and recorded as a warning finding, in line with leniency toward the
  model's output; it is never a reason to fail the review, because `read` is the
  conservative tier.
- **A fold always says why.** A `mechanical` hunk must carry a reason; a
  mechanical citation without one is repaired to `skim` and recorded.
- **Estimates are computed, not written.** Minutes come from line counts by
  tier and word counts of prose, with the constants in one module. The model
  only chooses what is in the brief and standard reading plans.
- **Nothing is written for compatibility.** The `hunkIds: string[]` shape in a
  diffChunk is replaced, not extended.

## Phases

### 1. Finer hunks (CLI, `src/review/prompt`, reader snippets)

**Seam.** `splitPatch(patch, target)` in `src/review/prompt/split-hunks.ts`
rewrites one file's unified diff so a large hunk becomes several real hunks,
each with its own synthesised `@@ -a,b +c,d @@ (part k of n)` header. It runs
in `gather` on each file's patch before `numberHunks`, so the catalog, the
annotated `diff.patch` the agent reads, the prompt's hunk table, coverage, the
stub and the reader all see parts as ordinary hunks without a change of their
own. Pure, no Node, so it lives beside the catalog.

**Where a hunk splits.** A boundary is a body line that starts a paragraph:
non-blank, the line before it blank, not a closing bracket or `end`, and not a
`+` directly after a `-` (that pair is one edit's before and after). Among the
paragraph starts in a range, the shallowest indentation wins, so a top-level
file splits between declarations and a class body between its members; a block
still over the target is split again one level deeper, which is what separates
a long function's signature and setup from its body. Doc comments and
decorators glue to what follows them because no blank line separates them.
Blocks are then packed greedily up to the target, so a file of many small
functions becomes parts of about the target size rather than one per function.
A part with no changed line joins its neighbour. `\ No newline` lines stay
with the line they annotate.

**Spans.** Each part's sides are counted from the hunk's start; a side with no
lines is written the way git writes one, as the line it sits after.

**Threshold.** `--split-hunks <lines>`: hunks with more changed lines than this
are split into parts of about this size; `0` keeps git's hunks. Default 10, chosen after a run at 10 told a new file and its tests across two chapters.
Refused with `--from`, since hunks are numbered at gather.

**Prompt.** One rule in the chapter rules: parts carry `(part k of n)`, are
hunks in their own right, and a large new file's parts belong in the chapters
whose stories they tell, not all in one chapter or the same file in several.

**Reader.** A snippet's context stops at the gap to the file's neighbouring
hunks (`ReviewFile.hunks`), equally on both sides, so a chapter citing part 1
never draws part 2's lines as its own. This also fixes an existing case: two
git hunks seven lines apart could already bleed one changed line.

**Tests.** Splitter unit tests (new file, class body, mixed edit kept whole,
no-newline marker, packing, zero target, spans round-trip through
`buildDiffHunkIndex`); a gather test that a long new file comes back as several
hunks and `diff.patch` carries each id; snippet tests for the fence; flag
parsing.

### 2. Attention tiers and proven facts (schema, prompt, CLI, reader)

- `diffChunks[].hunks: [{ id, tier: 'read' | 'skim' | 'mechanical', reason? }]`
  replaces `hunkIds`. Parser repairs as decided above.
- CLI facts per hunk: `whitespaceOnly` (the hunk vanishes under `git diff -w
--ignore-blank-lines`), `movedFrom: { filename, similarity }` (a part whose
  normalised lines match a removed part elsewhere at or above a threshold).
  Both shown in the catalog as hints, both carried on the resolved hunk.
- Reader: snippet groups never merge across tiers; a `mechanical` group draws
  as one row with its reason and a show control; the display menu gains a
  "skim" toggle that folds `skim` too. Badges for the facts.
- Acceptance: a review of this repository folds its lockfile-adjacent and
  rename-fallout hunks; the file view shows every hunk whatever its tier.

### 3. Chapter order and reading plan (prompt, schema, summary card)

- Prompt: order chapters so a reader never meets a consequence before its
  cause; a new type or helper before its callers; the closing wiring chapter
  last.
- Schema: `readingPlan: { brief: chapterId[], standard: chapterId[] }`. Full is
  every chapter. A chapter in `brief` is the review's weight; no separate field.
- Summary card: three rows, each with its chapters and a computed estimate.
  Chapter headings carry their own estimate.

### 4. Next-chapter footer and progress (reader, stores)

- A footer at the end of every section: "Mark read · Next: <title>", with the
  last section returning to the summary. Marking is explicit, never on scroll.
- Sidebar rows show read state and the header shows "n of m read"; a row's
  mark can be toggled there too.
- A persisted store keyed by the review (`ReviewMeta` needs a stable id; the
  run folder's name is the candidate), one more raw preference beside the five.

### 5. Affected unchanged code (schema, parse stage, bundle, reader)

- `chapters[].contextExcerpts: [{ filename, startLine, lineCount, reason }]`,
  at most two per chapter; the path must not be a changed file (those have
  diffs). The parse stage reads the span from the worktree at head and embeds
  the text in the bundle; a span that does not exist is dropped and recorded.
- Reader: a read-only Monaco editor under its own label, same card treatment as
  a diff, after the chapter's diffs.

### 6. Reader focus options (reader; CLI flag and prompt)

- Hide code comments: first as dimming by theme token colour, which keeps every
  line in place and needs no language work; then, if dimming is not enough, as
  hidden regions over comment token ranges. A hunk that is comments only says so
  instead of going blank. Display-menu toggle, persisted.
- `--overview-style <name>`: a small set of overview instructions written into
  `prompt.md`, so `--from run` reuses the choice. Candidate set: `story` (the
  current prose), `checklist` (what a reviewer should verify, as a list),
  `before-after` (what the system did and does now), `brief` (lede only).

### 7. Ask Claude Code (reader)

A quiet control per chapter that copies a prompt naming the review, the
chapter's lede and its cited paths with line spans, and asks for help verifying
the chapter. An inline "Copied — paste into Claude Code in this repository"
message replaces itself after a few seconds. No notifications package.

## Out of scope here

Delta review (ER-45), stack awareness (ER-46), existing PR comments (ER-47),
independent parts for very large PRs (stacked PRs make those rare), Markdown
rendering inside diffs.
