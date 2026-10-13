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

**The model's answer.** `diffChunks[].hunks: [{ "id", "tier", "reason"? }]`
replaces `hunkIds`. `tier` is `read`, `skim` or `mechanical`; `reason` is
required on `mechanical`, at most about twelve words, saying what kind of change
it is ("the same rename at 14 call sites").

- `read`: what a reviewer must understand to judge the change — new behaviour,
  logic, edge cases, anything risky. When unsure, `read`.
- `skim`: needed to follow the story but low-risk — plain wiring, test setup,
  docs that matter.
- `mechanical`: judged from its reason alone — a rename's call sites, imports,
  formatting, code moved unchanged, boilerplate.

**Leniency toward the model**, each repair recorded: a bare string id is a hunk
with no tier; a missing or unknown tier becomes `read`; `mechanical` without a
reason becomes `skim`. One aggregated warning per kind of repair per review
(`hunk-tier-missing`, `hunk-reason-missing`), naming how many hunks.

**Stored shape.** `DiffChunk.hunks` is `CitedHunk[]`: a `ResolvedDiffHunk` plus
`tier` and `reason?`. Where one hunk is cited twice (chunks merged in a chapter,
or `citedChunk` across chapters) the most attentive tier wins, read over skim
over mechanical, and a reason survives only on a mechanical result.

**Proven facts**, computed in the CLI from the patch, never by the model, in a
pure `src/review/prompt/hunk-facts.ts`, carried on the catalog hunk
(`DiffHunk`, and `ResolvedDiffHunk` through `ReviewFile.hunks` and resolution):

- `whitespaceOnly: true` — the hunk's removed and added lines are the same once
  every whitespace character is removed and blank lines dropped.
- `movedFrom` / `movedTo: { filename, similarity }` — a hunk's significant added
  lines (whitespace-collapsed, at least four characters, holding a letter or
  digit) are at least 80% found, as a multiset, among another hunk's significant
  removed lines, with at least three in common; the best match by overlap wins,
  and the removing hunk gets the mirror `movedTo`. Same file or another; never
  a hunk against itself. Part-sized hunks are what make this find a body lifted
  into a differently named function.

Facts reach the prompt's hunk table as hints (`[whitespace only]`,
`[moved from src/a.ts, 92%]`) and the reader as badges. They inform the tier;
they never set it.

**Reader.** A snippet group is consecutive hunks of one tier. A `mechanical`
group is drawn folded: one row with the tier, its reasons, its line count and a
Show control that opens that group in place. A display-menu toggle, "Skim:
shown / folded" (`er-fold-skim`, a raw preference, default shown), folds `skim`
the same way. Fact badges sit on the group's row. The file view never folds.

**Stub.** `--stub` tiers by fact: whitespace-only or moved hunks are
`mechanical` with the fact as the reason, everything else `read`, so the folds
can be seen without paying for a model.

**Done when** the sample bundle shows all three tiers and both facts; a stub
review of a branch with a moved function folds it; the gate passes; the area
maps are updated.

### 3. Chapter order and reading plan (prompt, schema, summary card)

**Order.** A guideline in the prompt: a reader never meets a consequence before
its cause. A new type, helper or schema comes before the code that uses it; the
core behaviour change before its wiring; the shared wiring-and-docs chapter
last. No schema field — the order of `chapters` is the order.

**Reading plan.** `readingPlan: { brief: chapterId[], standard: chapterId[] }`
on the review. `brief` is the one to three chapters someone with five minutes
must read to judge the change — where its risk is. `standard` is what a
reviewer approving it should read. Full is every chapter and needs no field.
Being in `brief` is how a chapter is marked as core; there is no separate weight.

Parsing, lenient toward the model and recorded: an unknown id is dropped
(note); `standard` is made a superset of `brief`, in chapter order (note); a
plan that arrives missing, or whose `brief` ends up empty, is dropped
(`reading-plan-dropped`, warning) and the review ships without one.

**Estimates, computed in the reader, never written by the model**, in one pure
module whose constants are the only place a speed is stated: prose at 200 words
a minute; a `read` hunk at 12 lines a minute, a `skim` hunk at 40, a folded
`mechanical` row at five seconds; a diagram at 30 seconds. A hunk's lines are
the longer of its two spans. A chapter's estimate rounds up to whole minutes,
at least one. A plan's estimate is the sum of its chapters', plus the overview
for every plan.

**Reader.** The summary card gains a "Reading plan" block after the overview:
three rows — Brief, Standard, Full — each with its estimate and its chapters as
links; Standard lists only what it adds to Brief. A chapter's header meta line
gains its estimate ("~3 min"). A brief chapter carries a quiet mark in the
sidebar.

**Stub.** `brief` is the first chapter, `standard` every chapter.

**Done when** the sample bundle carries a plan; a stub review shows the block;
the gate passes; the area maps are updated.

### 4. Next-chapter footer and progress (reader, stores)

**Which review.** `ReviewMeta` gains `baseSha` and `headSha`, filled by
`gather` from the target. A review's progress is keyed by repo, base and head,
so rendering the same range again keeps it; chapter ids that no longer exist
are ignored rather than cleaned up.

**Store.** `er-progress`, one localStorage key holding JSON — unlike the raw
preferences, it is a record and not a preference — `{ [reviewKey]: { read:
chapterId[], at: epochMs } }`, the fifty most recently touched reviews kept and
the rest evicted on write. Reading it must survive missing, malformed or
blocked storage without losing the reader.

**Footer**, at the end of every section:

- a chapter: a "Read" checkbox for that chapter, "n of m chapters read", and a
  primary "Next: <title>" button that marks the chapter read and moves on —
  focus to the next heading, as the keyboard does;
- the summary and the risk section: the Next button only;
- the last chapter: "Back to summary" in place of Next, and when every chapter
  is read, the count says so.

**Sidebar.** A read chapter's row carries a check and its title steps down to
`muted-foreground`; the chapters header says "n/m read". Toggling there and in
the footer is the same state.

**Done when** progress survives a reload and a re-render of the same range; the
footer walks every section in the sidebar's order; the gate passes; the maps
are updated.

### 5. Affected unchanged code (schema, parse stage, bundle, reader)

**The model's answer.** A chapter may carry `contextExcerpts: [{ filename,
startLine, endLine, reason }]`, at most two: unchanged code whose behaviour this
change alters without editing it — a caller, a subclass, a config or contract —
or the definition a changed call now leans on in a way the diff hides. Never a
file in Files Changed. Only lines the agent has read. `reason` is one sentence.

**Checked in two places.** The pure parser keeps the shape: more than two
excerpts, a changed file, a malformed or inverted span, or one over 60 lines is
dropped and recorded (`excerpt-dropped`, warning). The parse stage, which can
read git, then checks the file exists at the head commit and the span is inside
it, dropping and recording the same way, and writes the excerpted files'
contents to `excerpts.json` in the run folder. The render stage adds them to the
bundle's `files` as a file whose two sides are the same, so the reader slices
them like any other file and `--from render` needs no git.

**Reader.** After a chapter's diff cards, each excerpt is a card in the same
treatment as a diff card: its path, "unchanged · L10–30", the reason, and a
read-only Monaco editor with the file's real line numbers. It loads Monaco
through the same lazy factory as the diff editor, which stays the one place
that imports it.

**Stub.** None. **Sample bundle.** One excerpt, with its file.

**Done when** a hand-made answer with an excerpt renders it; a missing file or
an out-of-range span is dropped with a finding; the gate passes; the maps are
updated.

### 6. Reader focus options (reader; CLI flag and prompt)

**Dim comments.** A display-menu item, "Comments: normal / dimmed"
(`er-dim-comments`, a raw preference, default normal). Dimmed swaps the diff
editors to a theme that inherits `vs` / `vs-dark` and paints comment tokens in
the `subtle` token, italic. `subtle` is decoration and never text by the design
rules; a comment the reader has asked to push back is decoration by their
choice, which is why it is allowed here and nowhere else. Every line keeps its
place, so a hunk that is all comments still shows what changed. Truly hiding
comment lines would need per-language comment ranges and Monaco's hidden areas
on both sides of a diff kept in step; that is left until dimming proves too
little.

**Overview style.** `--overview-style <name>` chooses how the overview's and the
chapters' description bodies are written; ledes are unchanged. Written into
`prompt.md` as its own section, so `--from run` reuses it, and refused with a
`--from` past prompt like `--instructions`. Styles:

- `narrative` (default): the prose as it is today.
- `checklist`: what a reviewer should verify, as a short list.
- `before-after`: what the system did before and what it does now.
- `five-whys`: the chain of reasons behind the change, each answering the last.
- `plain`: explained for someone who has never seen this code.
- `tldr`: no body at all; the lede alone.

### 7. Ask Claude Code (reader)

A quiet icon button in each chapter's header (`aria-label` "Copy a prompt for
Claude Code"). It copies a prompt naming the change (title, repository, the
range), the chapter's title and lede, and each cited file with its line spans,
and asks Claude Code to help the reader check the chapter, leaving a line for
their own question. Beside the button, a short inline message, "Copied — paste
it into Claude Code in this repository", replaces itself after a few seconds;
announced through a polite live region. The clipboard API is tried first and
a hidden-textarea copy second; if both fail the message says so and shows the
prompt in a selectable block. No notifications package.

**Done when** the copied text names every cited span; the message appears and
clears; the gate passes; the maps are updated.

## Out of scope here

Delta review (ER-45), stack awareness (ER-46), existing PR comments (ER-47),
independent parts for very large PRs (stacked PRs make those rare), Markdown
rendering inside diffs.
