---
paths:
  - 'src/web/**'
---

# `src/web/` — the report's React code

The reader components, the theme, the stores and the viewer entry that
`vite.viewer.config.ts` builds into `er`'s single-file report.

Loaded when you open a file under `src/web/`. The layering rules are in
`AGENTS.md`; the look is in `design-system.md` beside this file.

```
src/web/
  components/        brand-mark (+ brand-mark.svg, imported so the report inlines it), caption (the one uppercase label), page-shell (the two page
                     widths — `reader` follows the toggle, `page` is fixed — shared with the topbar);
                     topbar/ (topbar: TopbarFrame, which the report's header fills with StaticBrand;
                     and display-menu — every display preference in one
                     labelled dropdown (diffs, long lines, layout, theme), the first three only when its
                     `reader` prop says so, and the three stores rehydrated on the menu itself because a
                     dropdown does not mount its rows until it is opened),
                     narrative/ (the reader — nothing here may import
                     jobs/, ReviewTarget or PullMetadata: chapter-reader (+ .module.css grid, resizable sidebar,
                     ?ch=/?file= state; takes review + ReviewMeta + the review's findings + an `actions` slot),
                     sections.ts (readerSections: the one ordered list of sections — summary, risk when there is an
                     assessment, then the chapters — that the sidebar renders and the keyboard walks),
                     findings-notice (the review's warning-severity findings, drawn in the summary card above
                     everything the reviewer said; nothing when there are none, and never anything in the local
                     report, which carries no findings),
                     chapter-sidebar (+ .module.css; the risk card is the risk section's only entry, a row carrying
                     a diagram is marked, a skipped file is dimmed, a file the chapters left out carries ○ (none of
                     its hunks cited) or ◐ (some) beside its stats with the reason in its title and hidden text;
                     its Files header carries the flat ⇄ tree toggle
                     for the changed-file list, one shared row component under both views, the tree drawn as nested
                     lists with aria-expanded on the directory buttons — a disclosure list, not an ARIA tree, since
                     there is no roving tabindex — and the fold state in component state),
                     file-tree.ts (pure, no rendering: ReviewFile[] → the directory tree, single-child directory
                     chains collapsed into one row), chapter-card (groupInsightsByFile splits the chapter's
                     insights: an anchored one goes down to its diff card, the rest stay in the Insights
                     section above them; the review's judgement calls for this chapter arrive already keyed
                     by file and go down the same way), judgement-calls.ts (pure: anchorJudgementCalls pairs
                     each of the review's questions with the first chapter citing its file, so the summary's
                     index and the chapter that draws it cannot disagree, and judgementCallsByFile keys one
                     chapter's share by file), summary-card (title/meta, the findings notice, overview
                     diagram, AI overview, the judgement-call index — titles linking to the chapter that draws
                     each, since the reader shows one section at a time and a question in chapter seven is
                     otherwise never met — author's description collapsed last), risk-card, file-view (one diff over
                     every hunk the chapters cited, merged by coverage.ts's citedChunk so neighbouring hunks are not
                     sliced twice, then its uncited hunks under their own label — coverage.byFile's entry is passed
                     in, never recomputed — or why it has none), skipped-file.ts (the copy for
                     ReviewFile.skipped reasons), insight-callout (InsightCallout and JudgementCallout over one
                     marginalia treatment; the judgement call takes amber `suggestion` rather than the token
                     named `question`, which is also the chapter eyebrow),
                     article.module.css (the reading measure + the diff bleed lane),
                     prose-passage (a Prose: the lede one step up the scale, the body as Markdown beneath),
                     markdown-text (+ .module.css; react-markdown + gfm + rehype-highlight),
                     inline-diff-chunk (+ .module.css; both sides from useFilePair, snippets per hunk group,
                     the asides for this file above the diff and capped at the measure — judgement calls first,
                     then the chapter's insights that named it,
                     lazy Monaco DiffEditor behind useHydrated, vs/vs-dark follows the scheme; the wrap preference
                     goes to the live widget as diffWordWrap, never through its construction options, so a flip
                     reflows in place instead of remounting; its lazy factory is also the one place that imports
                     the editor, because it is where loader.config pins the CDN and where loader.init is awaited —
                     a CDN that cannot be reached resolves the lazy to DiffUnavailable, a line of text in the card
                     instead of an empty body, since the library swallows that failure and no boundary sees it),
                     monaco-cdn.ts (MONACO_VERSION / MONACO_VS_URL: which Monaco the CDN serves, held to the
                     declared monaco-editor — the types' version — by the monaco-version guardrail),
                     file-source (where the diffs get files: GithubFileSource → /api/github/file fetcher,
                     EmbeddedFileSource → a ReviewBundle; useFilePair always mounts a fetcher, so the reader needs a
                     data router under either), risk-score,
                     use-narrative-keyboard,
                     diagram/ (SVG: text-metrics (estimated widths),
                     change-style (change → token; nodes are outlined, never filled), graph-layout (dagre, compound +
                     multigraph; beforeAfter splits into two panels off the change marks), sequence-layout (hand-rolled
                     columns × rows), graph-svg / sequence-svg (painters), diagram-figure (the `data-bleed` figure:
                     1:1 with horizontal scroll, legend, caption), diagram-modal (full-screen viewBox pan/zoom),
                     diagram.module.css)) — all browser-safe, styled via token() or a sibling CSS Module
  viewer/            the local report (vite.viewer.config.ts): index.html (the empty er-bundle element),
                     main.tsx (client-rendered, hash data router, stored width applied before render),
                     report-routes.tsx (the one catch-all route and its errorElement, apart from main.tsx so a test
                     can mount it), viewer-page
                     (a TopbarFrame with brand + the same DisplayMenu, then ChapterReader over
                     EmbeddedFileSource),
                     report-problem (the one "cannot show the review" surface: ReportProblem for a missing /
                     version-mismatch / invalid bundle, ReportCrashed as the route boundary — no topbar, and
                     nothing off the error, which React has already logged), sample-bundle.ts (what viewer:dev
                     renders unless ER_BUNDLE names a JSON file); the build inlines JS, CSS and fonts into one file and stamps its sources (viewer.stamp, which er checks);
                     Monaco still loads from the CDN
  stores/            Zustand, persisted: layout-width.ts (`er-layout`, bindLayoutWidth: full ⇄ wide), diff-view.ts (`er-diff-view`,
                     bindDiffView: split ⇄ unified), diff-wrap.ts (`er-diff-wrap`, bindDiffWrap: off ⇄ on, spelled the
                     way Monaco spells diffWordWrap), file-list-view.ts (`er-file-list`, bindFileListView: flat ⇄ tree;
                     bound from the sidebar's own toggle, not the topbar's), sidebar-width.ts (`er-sidebar`,
                     bindSidebarWidth: the reader's navigation column in pixels, clamped to SIDEBAR_WIDTHS rather
                     than matched, painted as `--review-sidebar-width` on `<html>` — a drag writes the variable
                     directly and commits to the store once on release), all five on raw-preference.ts (one word or one
                     number, not JSON).
                     diff-view.ts also holds useReaderColumn, the only store here that is never persisted: the column
                     width chapter-reader measures, with selectSpaceLimited over it — under SIDE_BY_SIDE_MIN_WIDTH the
                     toggle disables and inline-diff-chunk forces unified. A per-frame measurement is kept off the
                     persisted store because persist writes its slice after every set, unconditionally
  theme/             Editorial Iris tokens.ts (palette + per-scheme highlight.js colours + FONT_SIZES/DISPLAY_SIZE/
                     CAPTION_TYPE, the type scale + bannerStyle, the tinted panel the
                     findings notice uses) → theme.ts (Mantine ramps, fontSizes, sans + mono),
                     css-variables.ts (--er-* and --er-hljs-* vars), color-scheme.ts, theme.css (base + .hljs-* rules)
  lib/               github-api.ts (resource-route body types, GITHUB_ERROR_STATUS), use-hydrated.ts
  test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper, diagram-fixtures
```
