---
paths:
  - 'src/web/**'
---

# `src/web/` — the React Router app

Loaded when you open a file under `src/web/`. The layering rules and the
server-only split inside `web` are in `AGENTS.md`; the look is in
`design-system.md` beside this file.

```
src/web/
  root.tsx           Layout, MantineProvider, ColorSchemeScript, GEOMETRY_SCRIPT (stored layout width + sidebar width
                     applied before first paint), ErrorBoundary, middleware: [sessionMiddleware]
  entry.server.tsx   RR server entry (`reveal` default, logger instead of console); awaits bootJobs() before the first request
  routes.ts          route table — every file in routes/ must be listed here
  routes/            _gated.tsx (layout: requireUser) → _shell.tsx (layout: Topbar + JobNotifications; loader {user, serverNow, polling})
                       → home.tsx (index: hero + ReviewComposer + Recent; action POST /?index → startReview), history.tsx (?status=),
                         jobs.$id.tsx (live view; loader job + chunks, 404 → own ErrorBoundary; action intent=cancel|rerun),
                         reviews.$id.tsx (reader; loader: done job + review + GitHub fan-out via lib/review-metadata.server
                         → reviewMetaFromJob; the reader is wrapped in GithubFileSource, rerun passed as its actions,
                         not done → /jobs/:id, ?ch=/?file= client-side via shouldRevalidate; action intent=rerun)
                     _gated (chrome-less) → relink.tsx, api.github.repos.ts, api.github.pulls.ts, api.github.branches.ts,
                       api.github.file.ts (both blobs of one file, base + head in parallel, for the inline diff)
                       (resource routes the composer loads via useFetcher; bodies typed in lib/github-api.ts, failures
                       returned with a status, rejected token → /relink), api.jobs.$id.ts (?after=<seq> → {job, chunks},
                       polled by the live view), api.me.jobs.terminal.ts (?since=<iso> → {now, jobs}: the viewer's jobs
                       that turned terminal since then, polled by the notifier);  public: login.tsx,
                     auth.github.ts, auth.github.callback.ts, auth.logout.ts, health.ts.
  auth/              *.server.ts: cookies, session (createSessionStorage + rolling), authenticator (remix-auth),
                     context (userContext/sessionContext), session-middleware, gate-middleware (requireUser, signOutHeaders)
  components/        brand-mark (+ brand-mark.svg, imported so the report inlines it), caption (the one uppercase label), page-shell (the two page
                     widths — `reader` follows the toggle, `page` is fixed — shared with the topbar), color-scheme-toggle,
                     app-error (generic error page, used by root + route boundaries);
                     topbar/ (topbar: Topbar on TopbarFrame, which the local report's header reuses with
                     StaticBrand; topbar-nav, user-menu, and display-menu — every display preference in one
                     labelled dropdown (diffs, long lines, layout, theme), the first three only when its
                     `reader` prop says so, and the three stores rehydrated on the menu itself because a
                     dropdown does not mount its rows until it is opened),
                     jobs/ (job-list-row, status-badge, job-live-view (fetch-polls api/jobs/:id, cancel fetcher),
                     job-timeline (+ .module.css: rail/markers), live-phases (pure derivePhases/eyebrow/heading),
                     what-now, rerun-button, job-not-found (404 page shared with the reader), review-banners (the
                     hosted reader's truncation + staleness banners)), history/ (filter-chips,
                     empty-history), home/ (review-composer, target-combobox, recent-reviews, sparkline),
                     narrative/ (the reader, shared by the hosted route and the local report — nothing here may import
                     jobs/, ReviewTarget or PullMetadata: chapter-reader (+ .module.css grid, resizable sidebar,
                     ?ch=/?file= state; takes review + ReviewMeta + an `actions` slot),
                     sections.ts (readerSections: the one ordered list of sections — summary, risk when there is an
                     assessment, the chapters, then "Not discussed" when a chapter left a hunk uncited — that the
                     sidebar renders and the keyboard walks),
                     undiscussed-card (the backstop section: every uncited hunk, file by file, through the inline
                     diff; built from domain/review/coverage.ts, which chapter-reader computes once for it, the
                     sidebar and the sections),
                     chapter-sidebar (+ .module.css; the risk card is the risk section's only entry, a row carrying
                     a diagram is marked, a skipped file is dimmed, a file the chapters left out carries ○ (none of
                     its hunks cited) or ◐ (some) beside its stats with the reason in its title and hidden text;
                     its Files header carries the flat ⇄ tree toggle
                     for the changed-file list, one shared row component under both views, the tree drawn as nested
                     lists with aria-expanded on the directory buttons — a disclosure list, not an ARIA tree, since
                     there is no roving tabindex — and the fold state in component state),
                     file-tree.ts (pure, no rendering: ReviewFile[] → the directory tree, single-child directory
                     chains collapsed into one row), chapter-card, summary-card (title/meta, overview
                     diagram, AI overview, author's description collapsed last), risk-card, file-view (a file's chunks,
                     then its uncited hunks under their own label — coverage.byFile's entry is passed in, never
                     recomputed — or why it has none), skipped-file.ts (the copy for
                     ReviewFile.skipped reasons), insight-callout,
                     article.module.css (the reading measure + the diff bleed lane),
                     lead-markdown, markdown-text (+ .module.css; react-markdown + gfm + rehype-highlight),
                     inline-diff-chunk (+ .module.css; both sides from useFilePair, snippets per hunk group,
                     lazy Monaco DiffEditor behind useHydrated, vs/vs-dark follows the scheme; the wrap preference
                     goes to the live widget as diffWordWrap, never through its construction options, so a flip
                     reflows in place instead of remounting),
                     file-source (where the diffs get files: GithubFileSource → /api/github/file fetcher,
                     EmbeddedFileSource → a ReviewBundle; useFilePair always mounts a fetcher, so the reader needs a
                     data router under either), risk-score,
                     use-narrative-keyboard,
                     diagram/ (SSR'd SVG: text-metrics (estimated widths — the server cannot measure a string),
                     change-style (change → token; nodes are outlined, never filled), graph-layout (dagre, compound +
                     multigraph; beforeAfter splits into two panels off the change marks), sequence-layout (hand-rolled
                     columns × rows), graph-svg / sequence-svg (painters), diagram-figure (the `data-bleed` figure:
                     1:1 with horizontal scroll, legend, caption), diagram-modal (full-screen viewBox pan/zoom),
                     diagram.module.css)), notifications/ (job-notifications: fetch-polls api/me/jobs/terminal with
                     a 30 s overlap, toasts once per job id, suppressed on that job's pages, browser Notification when
                     hidden + granted) — all browser-safe, styled via token() or a sibling CSS Module
  viewer/            the local report (vite.viewer.config.ts, not the RR app): index.html (the empty er-bundle element),
                     main.tsx (client-rendered, hash data router, stored width applied before render), viewer-page
                     (a TopbarFrame with brand + the same DisplayMenu, then ChapterReader over
                     EmbeddedFileSource),
                     report-problem (missing / version-mismatch / invalid bundle), sample-bundle.ts (what viewer:dev
                     renders unless ER_BUNDLE names a JSON file); the build inlines JS, CSS and fonts into one file and stamps its sources (viewer.stamp, which er checks)
                     (`react-router build` wipes build/, so it builds second); Monaco still loads from the CDN
  stores/            Zustand, persisted: layout-width.ts (`er-layout`, bindLayoutWidth: full ⇄ wide), diff-view.ts (`er-diff-view`,
                     bindDiffView: split ⇄ unified), diff-wrap.ts (`er-diff-wrap`, bindDiffWrap: off ⇄ on, spelled the
                     way Monaco spells diffWordWrap), file-list-view.ts (`er-file-list`, bindFileListView: flat ⇄ tree;
                     bound from the sidebar's own toggle, not the topbar's), sidebar-width.ts (`er-sidebar`,
                     bindSidebarWidth: the reader's navigation column in pixels, clamped to SIDEBAR_WIDTHS rather
                     than matched, painted as `--review-sidebar-width` on `<html>` — a drag writes the variable
                     directly and commits to the store once on release), all five on raw-preference.ts (one word or one
                     number, not JSON, so root.tsx's pre-paint script can read it); last-target.ts (`er:last-target`, per user).
                     diff-view.ts also holds useReaderColumn, the only store here that is never persisted: the column
                     width chapter-reader measures, with selectSpaceLimited over it — under SIDE_BY_SIDE_MIN_WIDTH the
                     toggle disables and inline-diff-chunk forces unified. A per-frame measurement is kept off the
                     persisted store because persist writes its slice after every set, unconditionally
  theme/             Editorial Iris tokens.ts (palette + per-scheme highlight.js colours + FONT_SIZES/DISPLAY_SIZE/
                     CAPTION_TYPE, the type scale) → theme.ts (Mantine ramps, fontSizes, sans + mono),
                     css-variables.ts (--er-* and --er-hljs-* vars), color-scheme.ts, theme.css (base + .hljs-* rules)
  lib/               parse.server.ts (Zod parseParams / parseSearchParams / parseFormData), github.server.ts (requireGithubToken,
                     withGithub → /relink, githubFailure), github-api.ts (resource-route body types, GITHUB_ERROR_STATUS),
                     jobs-api.ts (JobPollResponse, TerminalJobsResponse, mergeChunks), rerun-action.server.ts (shared
                     intent=rerun handler),
                     review-metadata.server.ts (reader's view-time GitHub fan-out: PR header or branch head,
                     staleness compare; every section degrades on its own, no token → nothing fetched),
                     action-error.ts (ActionError + actionError()), use-polling.ts, use-hydrated.ts,
                     reader-route.ts (READER_HANDLE / useIsReader: how the topbar learns the page below it is the reader)
  test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper
```

- Gated pages nest under `routes/_gated.tsx` and must export a loader so the
  middleware chain runs. Public routes live outside it. The sign-in flow is in
  `auth.md` beside this file.
- Authorisation is explicit in loaders and actions: any signed-in user may read
  any job or review, only the owner may cancel one.
