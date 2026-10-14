---
paths:
  - 'src/report/**'
  - 'vite.config.ts'
---

# `src/report/` — the report

The React page `vite.config.ts` builds into one HTML file: the reader, its
chrome, the theme and the stores. `er`'s render stage fills that file's
`er-bundle` element with a `ReviewBundle` and writes it as `review.html`, which
is opened straight from disk. It is client-rendered, has no router and fetches
nothing but Monaco from the CDN.

Loaded when you open a file under `src/report/`. The layering rules are in
`AGENTS.md`; the look is in `design-system.md` beside this file.

```
src/report/
  index.html         the page, with the empty er-bundle element the render stage fills
  main.tsx           reads the embedded bundle, applies the stored layout and sidebar widths, renders ReportRoot
  report-root.tsx    ReportRoot: ReportPage under a class error boundary whose fallback is ReportCrashed
  report-page.tsx    the header (TopbarFrame: Brand + DisplayMenu), then ChapterReader over EmbeddedFileSource,
                     or ReportProblem when there is no bundle to read
  report-problem.tsx the one "cannot show the review" surface: ReportProblem for a missing / version-mismatch /
                     invalid bundle, ReportCrashed for a reader that threw — nothing taken off the error, which
                     React has already logged
  sample-bundle.ts   what `report:dev` renders unless ER_BUNDLE names a JSON file; it carries one excerpt of
                     unchanged code (SAMPLE_EXCERPT_FILE) in the cadence-table chapter
  chrome/            brand-mark (+ brand-mark.svg, imported so the build inlines it), caption (the one uppercase
                     label), page-shell (SHELL_MAX_WIDTH, the toggle-driven width shared with the topbar),
                     topbar (TopbarFrame, Brand), display-menu (every display preference in one labelled
                     dropdown: diffs, long lines, comments, file headers, skim hunks, hunk debug, layout, theme — comments
                     and skim hunks each with a fade slider beneath while they are dimmed or marked)
  reader/            chapter-reader (+ .module.css grid, resizable sidebar, ?ch=/?file= state through
                     hash-params.ts — `#/?ch=…`, because the page is opened from file:// where the query string
                     belongs to the file; each change is a history entry; the review's read chapters from the
                     progress store, handed to the sidebar and the footer alike; the chapter card keyed by its
                     chapter, so a full-file view opened in one never carries into the next),
                     sections.ts (readerSections: the one ordered list of sections — risk when there is an
                     assessment, the summary, then the chapters — that the sidebar renders, the keyboard walks
                     and the footer's Next follows; a chapter in the reading plan's brief is `core`;
                     readCountLabel, the "n of m chapters read" both the footer and the sidebar say),
                     section-footer (the last thing in every section card, bled to the full column so its rule
                     spans the diffs and Next sits bottom right: a chapter's Read checkbox and its
                     count, then a primary "Next: <title>" that marks the chapter read and moves on, focusing
                     the next heading as the keyboard does — opening a chapter never marks it; the last chapter's
                     is "Back to summary", which marks it too; the summary and risk get Next alone, and a summary
                     with nothing after it no footer),
                     chapter-sidebar (+ .module.css; the risk card is the risk section's only entry, a row carrying
                     a diagram is marked, a core chapter carries a star and a chapter marked read a tick, the three
                     one outline icon size and one muted-foreground colour, grouped tight at the row's end in that
                     order — the tick last, so it sits in one place down the list — each with hidden text ("core
                     chapter", "has a diagram", "read"), and the Chapters header
                     "n/m read", a skipped file is dimmed, a file the chapters left out carries ○ (none of
                     its hunks cited) or ◐ (some) beside its stats with the reason in its title and hidden text,
                     and the file whose diff the reader has scrolled to carries a rail (use-reading-file.ts) that is
                     a quieter, separate mark from the wash on a file the file view shows;
                     its Files header carries the flat ⇄ tree toggle for the changed-file list, one shared row
                     component under both views, the tree drawn as nested lists with aria-expanded on the
                     directory buttons — a disclosure list, not an ARIA tree, since there is no roving tabindex —
                     and the fold state in component state),
                     file-tree.ts (pure: ReviewFile[] → the directory tree, single-child chains collapsed into one
                     row), chapter-card (groupInsightsByFile splits the chapter's insights: an anchored one goes
                     down to its diff card, the rest stay in the Insights section above them; the chapter's
                     judgement calls arrive keyed by file and go down the same way; the header's meta line ends
                     in the chapter's estimate, "~3 min"; the eyebrow shares its row with the Ask button; the
                     chapter's excerpts of unchanged code come after its diffs under "Unchanged code it affects",
                     and are not counted as files touched),
                     ask-claude-code (AskClaudeCode: the quiet icon button, "Copy a prompt for Claude Code", wearing
                     Clawd — Claude Code's mascot as its start-up banner draws it, an inline SVG in currentColor, since
                     the icon set has no mark for it — on
                     every chapter's header and nowhere else — the clipboard API, then a hidden-textarea
                     execCommand copy, and when both fail the prompt in a read-only block, focused and selected,
                     to copy by hand; what happened is said beside the button in a polite live region, a
                     confirmation clearing after CONFIRMATION_MS, and all of it cleared on a chapter change
                     because the card keys it by chapter; the button and status sit out of flow, so the eyebrow
                     row keeps the caption's height and a chapter's title starts where the summary's does; the
                     manual block is wrapped in aria-live="off", since the reader's column is itself a polite
                     region that would read the whole prompt out; no toast, no notifications package),
                     ask-prompt.ts (pure: askPrompt(meta, chapter, files), the copied text — the change by
                     meta.kind (PR number and title, the branch, or the staged changes), the range as
                     12-character shas with its `git diff`, the chapter's title and lede, each cited hunk with
                     both its sides, `head 40-45, base 40-48` — a cited hunk carries git's context lines, so
                     neither side alone is the change — the base side under a renamed file's origin path, and
                     only the side that exists for a new or deleted file, marked `(new)` or `(gone at head)`;
                     the chapter's excerpts, then a line left for the reader's question; never any code, since
                     Claude Code stands in the repository),
                     context-excerpt (+ .module.css; ContextExcerptCard: a CodeCard with the path,
                     "unchanged · L3–14" and the reason, then a read-only Monaco editor holding only the
                     excerpt's lines, its gutter offset to the file's own numbers as a collapsed diff snippet's
                     is, theme and wrap following the diff's; the file comes through useFilePair, and a file
                     the bundle lacks is a line of text, never an empty editor),
                     reading-time.ts (pure, and the only place a reading speed is stated: prose at 200 words a
                     minute — a chapter's lede, body and insight texts, the overview's lede and body — a `read`
                     hunk at 25 changed lines a minute, `skim` at 100, a hunk's changedLines being what it adds
                     and removes, git's context left out; a diagram 30 seconds, an excerpt's lines at the skim
                     speed and its reason as prose; a chapter rounds up to whole minutes, at least one;
                     readingPlanRows: Brief, Standard and Full, each the overview plus its chapters' seconds,
                     rounded once — summing the headers' rounded minutes would charge every chapter up to a
                     minute it does not take — listing only the chapters it adds to the plan before it), judgement-calls.ts (pure:
                     anchorJudgementCalls pairs each question with the first chapter citing its file, so the
                     summary's index and the chapter that draws it cannot disagree), summary-card (title/meta,
                     overview, the reading plan — Brief, Standard and Full, each with its estimate and the
                     chapters it adds as links, numbered as the sidebar numbers them — then the overview diagram, the judgement-call index — titles
                     linking to the chapter that draws each — and the author's description collapsed last), risk-card, risk-score,
                     file-view (one diff over every hunk the chapters cited, merged by coverage.ts's citedChunk,
                     then its uncited hunks under their own label, or why it has none), skipped-file.ts (the copy
                     for ReviewFile.skipped reasons), insight-callout (InsightCallout and JudgementCallout over one
                     marginalia treatment), article.module.css (the reading measure + the diff bleed lane),
                     prose-passage (a Prose: the lede one step up the scale, the body as Markdown beneath),
                     markdown-text (+ .module.css; react-markdown + gfm + rehype-highlight),
                     file-source (EmbeddedFileSource: both sides of every file the bundle carries, and the review's
                     record of each changed file; useFilePair, useReviewFile, useReviewFiles — an excerpted file
                     has a pair and no record, which is what keeps it out of every changed-file list), file-origin.ts (the "Renamed from … · N% similar"
                     wording the file view, the diff card header and the sidebar row share),
                     inline-diff-chunk (+ .module.css; both sides from useFilePair, snippets per hunk group
                     (inline-diff-snippets.ts: a group is consecutive hunks whatever their tiers, and its context
                     stops at the unchanged lines between it and the file's neighbouring hunks, so the flush parts
                     of a split hunk never draw each other's lines); nothing folds, and skim hunks are drawn like
                     any other unless er-skim-marks says `marked` (or er-hunk-debug says `on`, which labels every
                     hunk on its own, faded only as skim marks would): then each region hunk-marks.ts names is
                     measured from the editors' line geometry after each layout, stacked view zones included (a
                     zone under a hunk's last line is the next hunk's when that hunk starts there), and drawn
                     over the editor as a capped bracket down its right edge in the region's tone, a label on
                     the line above it (most often the blank one a split is cut after) whose path gives way from
                     its start, that folds to a tab and, while pointed at, outlines the region's lines, and a wash
                     over each pane's lines toward the editor's background (read off Monaco's own element,
                     which is the only one that defines it) at `--review-skim-fade`, half of it for a read move
                     — an overlay rather than decorations, since no decoration reaches the stacked view's
                     removed lines, and one measurement for all of it, so a labelled region is always the one
                     that fades; the file stays one editor the find widget reaches; each proven fact is
                     one tag in the card's header over every line it holds for, the similarity in its hover;
                     the full-file view keeps the chapter's hunks, so its marks stay;
                     the asides for this file above the diff — judgement calls first, then the chapter's
                     insights that named it — and a lazy Monaco DiffEditor, its theme from useEditorTheme;
                     the wrap preference goes to the live widget as diffWordWrap, never through its
                     construction options, so a flip reflows in place instead of remounting; CodeCard and
                     CodeCardHeader, the frame and sticky path header a diff card and an excerpt card share —
                     only a diff's carries data-diff-file; the header is a grid of path, facts and actions, the
                     path never wrapping: its file name whole and its directory cut from the start behind an
                     ellipsis, the whole path in its hover; no language badge, which the extension already says;
                     a header whose facts can outgrow a line (a diff card with an origin or a fact tag) carries a
                     chevron that flips er-file-headers for every card — facts beside the path, clipped, or on
                     rows of their own below it),
                     monaco-editors (the one place that imports the editor: one shared load, where
                     loader.config pins the CDN and loader.init is awaited, behind two lazies — DiffEditor and
                     CodeEditor, the plain editor an excerpt uses — so a CDN that cannot be reached resolves each
                     to a line of text in its card ("this diff" / "this excerpt can't be shown") instead of an
                     empty body; the dimmed themes defined on that load, before either editor mounts;
                     useEditorTheme, the theme both are handed — vs/vs-dark by the scheme, or its dimmed twin
                     when er-dim-comments says so — which the library applies to the live editor with
                     setTheme, so a flip never remounts; the offset gutter helpers, the relayout once the
                     reader's column settles, and the scroll kept on a click's focus, which both editors share),
                     hunk-marks.ts (pure: provenNote, a proven fact's few words and its hover — a move said as
                     unchanged or with edits, the percentage kept for the hover; factTags, one header tag per
                     fact with its hunks' touching ranges joined; hunkMarks, the regions a diff labels — every
                     skim hunk, as "Skim · <fact> · <the review's reason>", and every hunk with a fact whatever
                     its tier — neighbours saying the same joined into one; hunks sharing a label but not a
                     hover, such as two edited moves at different strengths, give each its own line in it;
                     each note carries a tone, `move` or `plain`, its label in runs with the paths marked, and
                     each mark a fade, `skim`, `move` for a moved hunk the review says to read, or `none`;
                     debugMarks, every hunk as its own region labelled with its id, tier and split part),
                     monaco-themes.ts (the dimmed twins of vs and vs-dark: inherit the base, and give `comment`
                     and the sub-scopes Monaco's tokenizers emit italic, underline and strikethrough together,
                     a style no base theme uses, so theme.css finds them by `.mtki.mtku.mtks`, drops the lines and
                     fades them by opacity, as hard as `--review-comment-fade` says, in their own colour into the
                     band or background behind them;
                     defineEditorThemes, editorTheme),
                     monaco-cdn.ts (MONACO_VERSION / MONACO_VS_URL: which Monaco the CDN serves, held to the
                     declared monaco-editor — the types' version — by the monaco-version guardrail),
                     use-reading-file.ts (which file's diff card is pinned under the topbar, re-read on scroll and
                     on the column's own resize, for the sidebar's mark; every card carries data-diff-file),
                     use-narrative-keyboard
  diagram/           SVG: text-metrics (estimated widths, and cutFrom: the whole of a label the fit had to cut,
                     which every painter hangs on an SVG <title>, so a hover recovers a path two nodes share the
                     drawn half of), change-style (change → token; nodes are outlined,
                     never filled), graph-layout (dagre, compound + multigraph; beforeAfter splits into two panels
                     off the change marks), sequence-layout (hand-rolled columns × rows), graph-svg / sequence-svg
                     (painters), diagram-figure (the `data-bleed` figure: 1:1 with horizontal scroll, legend,
                     caption), diagram-modal (full-screen viewBox pan/zoom), diagram.module.css
  stores/            Zustand, persisted, each hydrating from localStorage as it loads: layout-width.ts (`er-layout`,
                     full ⇄ wide; followLayoutWidth keeps `--review-max-width` on `<html>`), diff-view.ts
                     (`er-diff-view`, split ⇄ unified), diff-wrap.ts (`er-diff-wrap`, off ⇄ on, spelled the way
                     Monaco spells diffWordWrap), file-list-view.ts (`er-file-list`, flat ⇄ tree), sidebar-width.ts
                     (`er-sidebar`, the navigation column in pixels, clamped to SIDEBAR_WIDTHS rather than matched;
                     followSidebarWidth paints `--review-sidebar-width` on `<html>` — a drag writes the variable
                     directly and commits to the store once on release), dim-comments.ts (`er-dim-comments`,
                     normal ⇄ dimmed: comments in the code viewers at full strength or faded, every line kept in
                     place), comment-fade.ts (`er-comment-fade`, how hard dimmed comments fade, clamped to
                     COMMENT_FADES; followCommentFade paints `--review-comment-fade`), skim-marks.ts (`er-skim-marks`, plain ⇄ marked, plain by default: skim hunks drawn
                     like any other, or faded and labelled), skim-fade.ts (`er-skim-fade`, how hard marked skim
                     hunks fade, clamped to SKIM_FADES; followSkimFade paints `--review-skim-fade`, which the
                     .wash class reads) — both made by fade.ts's createFadePreference, a percentage painted on
                     `<html>` as a fraction, so a change restyles every editor without re-rendering one, and a
                     preview that paints without storing, which the display menu's slider uses mid-drag, file-headers.ts (`er-file-headers`, full ⇄ one-line:
                     a code card header's facts on rows of their own, or kept beside the path), hunk-debug.ts
                     (`er-hunk-debug`, off ⇄ on: every hunk labelled with its id, tier and split part, for
                     judging the tiers), all eleven on
                     raw-preference.ts (one word
                     or one number, not JSON). progress.ts (`er-progress`) is the one record rather than a
                     preference, so it is JSON and not on raw-preference: `{ [repo|baseSha|headSha]: { read:
                     chapterId[], at } }`, the 50 most recently touched reviews kept; written over what storage
                     holds at that moment, so another tab's review survives; read leniently, an unreadable
                     review or value being no progress, and every storage call caught.
                     diff-view.ts also holds useReaderColumn, the only store here that is never persisted: the
                     column width chapter-reader measures, with selectSpaceLimited over it — under
                     SIDE_BY_SIDE_MIN_WIDTH the toggle disables and inline-diff-chunk forces unified. A per-frame
                     measurement is kept off the persisted store because persist writes its slice after every set
  theme/             Editorial Iris tokens.ts (palette + per-scheme highlight.js colours + FONT_SIZES/DISPLAY_SIZE/
                     CAPTION_TYPE, the type scale) → theme.ts (Mantine ramps, fontSizes, sans + mono),
                     css-variables.ts (--er-* and --er-hljs-* vars), color-scheme.ts, theme.css (base + .hljs-* rules),
                     oklch.ts (oklch → linear sRGB: the arithmetic the palette guardrail checks contrast and gamut
                     with)
  test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper, diagram-fixtures
```

The build (`vite.config.ts`) inlines JS, CSS and fonts into
`build/report/shell.html`, puts `chrome/brand-mark.svg` in its head as a
data-URI favicon, and writes `shell.stamp` beside it, a hash of the
report's sources that `er` checks before each render and rebuilds on when it
differs (`src/cli/shell-stamp.ts`). `report:dev` serves the same page with the
bundle injected by a dev-server plugin.
