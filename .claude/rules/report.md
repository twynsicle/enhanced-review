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
  sample-bundle.ts   what `report:dev` renders unless ER_BUNDLE names a JSON file
  chrome/            brand-mark (+ brand-mark.svg, imported so the build inlines it), caption (the one uppercase
                     label), page-shell (SHELL_MAX_WIDTH, the toggle-driven width shared with the topbar),
                     topbar (TopbarFrame, Brand), display-menu (every display preference in one labelled
                     dropdown: diffs, long lines, layout, theme)
  reader/            chapter-reader (+ .module.css grid, resizable sidebar, ?ch=/?file= state through
                     hash-params.ts — `#/?ch=…`, because the page is opened from file:// where the query string
                     belongs to the file; each change is a history entry),
                     sections.ts (readerSections: the one ordered list of sections — summary, risk when there is an
                     assessment, then the chapters — that the sidebar renders and the keyboard walks),
                     chapter-sidebar (+ .module.css; the risk card is the risk section's only entry, a row carrying
                     a diagram is marked, a skipped file is dimmed, a file the chapters left out carries ○ (none of
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
                     judgement calls arrive keyed by file and go down the same way), judgement-calls.ts (pure:
                     anchorJudgementCalls pairs each question with the first chapter citing its file, so the
                     summary's index and the chapter that draws it cannot disagree), summary-card (title/meta,
                     overview diagram, overview, the judgement-call index — titles linking to the chapter that
                     draws each — and the author's description collapsed last), risk-card, risk-score,
                     file-view (one diff over every hunk the chapters cited, merged by coverage.ts's citedChunk,
                     then its uncited hunks under their own label, or why it has none), skipped-file.ts (the copy
                     for ReviewFile.skipped reasons), insight-callout (InsightCallout and JudgementCallout over one
                     marginalia treatment), article.module.css (the reading measure + the diff bleed lane),
                     prose-passage (a Prose: the lede one step up the scale, the body as Markdown beneath),
                     markdown-text (+ .module.css; react-markdown + gfm + rehype-highlight),
                     file-source (EmbeddedFileSource: both sides of every file the bundle carries; useFilePair),
                     inline-diff-chunk (+ .module.css; both sides from useFilePair, snippets per hunk group
                     (inline-diff-snippets.ts), the asides for this file above the diff — judgement calls first,
                     then the chapter's insights that named it — and a lazy Monaco DiffEditor, vs/vs-dark following
                     the scheme; the wrap preference goes to the live widget as diffWordWrap, never through its
                     construction options, so a flip reflows in place instead of remounting; its lazy factory is
                     the one place that imports the editor, because it is where loader.config pins the CDN and
                     where loader.init is awaited — a CDN that cannot be reached resolves the lazy to
                     DiffUnavailable, a line of text in the card instead of an empty body),
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
                     directly and commits to the store once on release), all five on raw-preference.ts (one word
                     or one number, not JSON).
                     diff-view.ts also holds useReaderColumn, the only store here that is never persisted: the
                     column width chapter-reader measures, with selectSpaceLimited over it — under
                     SIDE_BY_SIDE_MIN_WIDTH the toggle disables and inline-diff-chunk forces unified. A per-frame
                     measurement is kept off the persisted store because persist writes its slice after every set
  theme/             Editorial Iris tokens.ts (palette + per-scheme highlight.js colours + FONT_SIZES/DISPLAY_SIZE/
                     CAPTION_TYPE, the type scale) → theme.ts (Mantine ramps, fontSizes, sans + mono),
                     css-variables.ts (--er-* and --er-hljs-* vars), color-scheme.ts, theme.css (base + .hljs-* rules)
  test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper, diagram-fixtures
```

The build (`vite.config.ts`) inlines JS, CSS and fonts into
`build/report/shell.html` and writes `shell.stamp` beside it, a hash of the
report's sources that `er` checks before each render and rebuilds on when it
differs (`src/cli/shell-stamp.ts`). `report:dev` serves the same page with the
bundle injected by a dev-server plugin.
