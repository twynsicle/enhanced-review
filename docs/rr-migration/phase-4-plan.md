# Phase 4 — Web port

**Goal:** every page and component the old app had, rebuilt on React Router
8 + Mantine 9 on top of the Phase 1 theme and the Phase 3 domain: loaders
and actions with `useFetcher` (D10), resource routes for the GitHub lists and
for polling (D5, D6), Zustand for persisted client preferences (A3), Mantine
notifications, Monaco loaded client-only (A2), keyboard navigation, the five
legacy component tests ported to the `web` project, and `legacy/` deleted at
the end. Exit: the app is runnable end to end again (D12) and every Phase 0
baseline screenshot has a signed-off Phase 4 counterpart (A11).

Parent: [00-overview.md](./00-overview.md) — D2, D5, D6, D10, D12; A2, A3,
A10, A11, A12.

Builds on: [phase-1-plan.md](./phase-1-plan.md) (theme tokens, `token()`,
`LAYOUT_WIDTHS`, colour-scheme manager), [phase-2-plan.md](./phase-2-plan.md)
(P2-D5 gate + `_gated` layout, cookies), [phase-3-plan.md](./phase-3-plan.md)
(P3-D4 `.server.ts` split, P3-D12 `githubLogin` on job rows, the error
classes the actions map to HTTP statuses).

Inventory source: a full read of `legacy/app`, `legacy/components` and
`legacy/lib` (props, state, strings, styling, data flow) done before this plan;
the numbers quoted below (line counts, class counts) come from it.

---

## Phase-level decisions

Answers from the question round are marked **(user)**.

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-D1  | **Pickers use the Mantine `Combobox` primitive (user).** `Combobox` + `Combobox.Search` + custom option rows + a custom trigger button, in one generic `TargetCombobox<T>` that keeps the legacy prop surface (`items \| null` = loading, `getKey`, `getSearchValue`, `renderItem`, `renderTrigger`, `placeholder`, `searchPlaceholder`, `emptyMessage`). Search stays inside the dropdown as on `main`.                                                                                                                                                                                                                        |
| P4-D2  | **Fixes over fidelity, three of them (user):** (a) Monaco follows the colour scheme (`vs` in light, `vs-dark` in dark) and the markdown code-fence background comes from theme tokens, not `#0d1117`; (b) the orphaned `chapter-page-rail.tsx` is not ported; (c) `/jobs/:id` navigates to `/reviews/:id` (replace) when a poll observes the transition to `done` while the page is open. A page that _loads_ already `done` still shows "Read the review →". Everything else reproduces `main`.                                                                                                                                |
| P4-D3  | **Tests: port the five legacy component tests + unit tests for every loader/action and resource route (user).** Route tests mock the domain modules with `vi.mock` (the `health.test.ts` pattern) and assert statuses, redirects and `ActionError` shapes. No new component tests for the composer or the live view; those are covered by the screenshot protocol.                                                                                                                                                                                                                                                              |
| P4-D4  | **Screenshot sign-off per page (user).** After each page commit the matching Phase 0 cells are re-captured in both schemes into `screenshots/phase-4/`, composited baseline-left / new-right into `screenshots/compare/` (PowerShell + System.Drawing, no new dependency) and sent to the user before the next page starts. Deltas the user accepts are listed under Deviations.                                                                                                                                                                                                                                                |
| P4-D5  | **App shell is a second pathless layout.** `routes/_shell.tsx` nests inside `_gated.tsx` and renders `Topbar` + `<Outlet />` + `JobNotifications`; its loader supplies `user`, `serverNow` and the polling intervals. `/relink` and the resource routes stay directly under `_gated` (gate, no chrome). Public pages (`/login`, `/denied`) keep their own minimal chrome as on `main`.                                                                                                                                                                                                                                          |
| P4-D6  | **One `ActionError` shape, one place.** `src/web/lib/action-error.ts` (shared with the browser): `{ ok: false; reason: 'job_in_flight' \| 'not_cancellable' \| 'not_found' \| 'invalid_target' \| 'head_resolution_failed' \| 'unknown'; message: string; activeJobId?: string }`, returned with `data(err, { status })` — 409, 409, 404, 400, 502, 500. Success is `redirect('/jobs/:id')` (create, rerun) or `{ ok: true }` (cancel). A rejected GitHub token is **not** an `ActionError`: the action (or resource loader) throws `redirect('/relink')`, which `useFetcher` follows.                                          |
| P4-D7  | **GitHub token handling for loaders lives in `src/web/lib/github.server.ts`.** `requireGithubToken(request)` returns the cookie value or throws `redirect('/relink')`; `withGithub(request, fn)` builds the per-request Octokit, runs `fn`, and turns `GithubAuthError` into the same redirect (clearing the token cookie). Every GitHub-touching loader/action uses these two; none re-implements the mapping.                                                                                                                                                                                                                 |
| P4-D8  | **Inline diff fetches both sides in one round trip.** `GET /api/github/file?owner&repo&path&base&head` returns `{ base: GithubResult<FileAtRef>, head: GithubResult<FileAtRef> }` (the loader runs the two `getFileAtRef` calls in parallel). The component keeps the legacy state machine (both `not-found` → error, one side `not-found` → empty file) but needs one `useFetcher` instead of two hand-rolled fetches.                                                                                                                                                                                                         |
| P4-D9  | **Polling is one hook.** `usePolling({ enabled, intervalMs, tick })` in `src/web/lib/use-polling.ts` wraps `useInterval` + `useDocumentVisibility` from `@mantine/hooks`: it ticks immediately on enable, pauses while the tab is hidden and resumes with an immediate tick. The live view (`/api/jobs/:id?after=`) and the notifier (`/api/me/jobs/terminal?since=`) both use it with `useFetcher().load()`. Intervals come from `LIVE_POLL_MS` (2000) and `TERMINAL_POLL_MS` (10000), new optional env keys, threaded to the client by the `_shell` loader.                                                                   |
| P4-D10 | **Zustand persists two things.** `stores/layout-width.ts` (key `er-layout`, `narrow \| wide`; a subscriber sets `--review-max-width` on `<html>`) and `stores/last-target.ts` (key `er:last-target`, a map `userId → LastTarget`; the legacy per-user key suffix folds into the map because Zustand persist wants one key and the old PocketBase user ids are meaningless now). A pre-paint `LayoutWidthScript` in `root.tsx` reads `er-layout` so a wide layout does not flash narrow, exactly as `ColorSchemeScript` does for the scheme. Sidebar width in the reader stays component state (it was not persisted on `main`). |
| P4-D11 | **Notifications are Mantine's.** `notifications.show()` with `color` mapping `success → mint`, `destructive → risk`, `default → gray`, and an inline "View" `Anchor` in the message that navigates with `useNavigate`. The browser `Notification` API path (hidden tab + permission granted) and the "Enable notifications" menu item are kept as on `main`.                                                                                                                                                                                                                                                                    |
| P4-D12 | **highlight.js colours come from tokens.** `theme.css` drops the global `github-dark.css` import; ~15 `.hljs-*` rules map onto new `--er-hljs-*` variables defined per scheme in `css-variables.ts`. This is what makes P4-D2(a) possible without shipping two vendor stylesheets.                                                                                                                                                                                                                                                                                                                                              |
| P4-D13 | **CSS Modules are allowed in exactly four places**, each justified in §3: `markdown-text.module.css`, `chapter-sidebar.module.css`, `inline-diff-chunk.module.css`, `job-timeline.module.css`. Everything else is Mantine components + style props + `token()`.                                                                                                                                                                                                                                                                                                                                                                 |
| P4-D14 | **Icons are Tabler** (`@tabler/icons-react`, already a dependency): `IconArrowRight`, `IconBell`, `IconClock`, `IconGitBranch`, `IconGitPullRequest`, `IconLock`, `IconLogout`, `IconArrowsMaximize` / `IconArrowsMinimize`, `IconMoon` / `IconSun`, `IconSparkles`. Text glyphs (`❖ › ▸ ▍ ✓ ● ! ◦ → −`) stay literal strings.                                                                                                                                                                                                                                                                                                  |
| P4-D15 | **Job rows are shared.** `components/jobs/job-list-row.tsx` (avatar · title · sub-line · risk pill · status badge) serves both `/history` and the home "Recent" card; the two identical copies on `main` collapse into one. Same for `StatusBadge` and `timeAgo` (`src/common/time-ago.ts`, already ported).                                                                                                                                                                                                                                                                                                                    |

---

## 1. Target tree (additions and changes only)

```
src/
  config/env.ts                 + LIVE_POLL_MS, TERMINAL_POLL_MS (optional ints)
  web/
    root.tsx                    + LayoutWidthScript (pre-paint --review-max-width)
    routes.ts                   full table below
    routes/
      _gated.tsx                unchanged
      _shell.tsx                NEW pathless layout: Topbar + Outlet + JobNotifications; loader {user, serverNow, polling}
      home.tsx                  index: loader (recent 5 + 14-day sparkline buckets), action (create review)
      history.tsx               loader (?status=, 100 rows)
      jobs.$id.tsx              loader (job + chunks); action intent=cancel | rerun
      reviews.$id.tsx           loader (review, view-time fan-out, staleness); redirects to /jobs/:id when not done
      api.github.repos.ts       resource: RepoSummary[]
      api.github.pulls.ts       resource: /api/github/repos/:owner/:repo/pulls
      api.github.branches.ts    resource: /api/github/repos/:owner/:repo/branches
      api.github.file.ts        resource: both sides of one file (P4-D8)
      api.jobs.$id.ts           resource: ?after=<seq> → { job, chunks } (D5)
      api.me.jobs.terminal.ts   resource: ?since=<iso> → { now, jobs } (D6)
      login.tsx / denied.tsx / relink.tsx   restyled where the baselines say so
      skeleton.tsx              DELETED (with src/web/test/skeleton.test.tsx)
    components/
      brand-mark.tsx, color-scheme-toggle.tsx      existing
      topbar/       topbar.tsx, topbar-nav.tsx, user-menu.tsx, layout-width-toggle.tsx
      home/         review-composer.tsx, target-combobox.tsx, recent-reviews.tsx, sparkline.tsx
      jobs/         job-list-row.tsx, status-badge.tsx, job-live-view.tsx, job-timeline.tsx (+ .module.css),
                    what-now.ts, rerun-button.tsx
      history/      empty-library.tsx, filter-chips.tsx
      narrative/    chapter-reader.tsx, chapter-sidebar.tsx (+ .module.css), chapter-card.tsx, summary-card.tsx,
                    people-card.tsx, risk-score.tsx, insight-callout.tsx, lead-markdown.tsx,
                    markdown-text.tsx (+ .module.css), file-view.tsx, inline-diff-chunk.tsx (+ .module.css),
                    review-banners.tsx, use-narrative-keyboard.ts
      notifications/ job-notifications.tsx
    lib/
      parse.server.ts           existing
      action-error.ts           P4-D6 (shared)
      github.server.ts          P4-D7
      use-polling.ts            P4-D9
      use-hydrated.ts           useSyncExternalStore hydration guard (A2)
      job-view.ts               JobView / ChunkView types + toJobView() (shared; Dates → ISO strings)
    stores/
      layout-width.ts, last-target.ts   P4-D10
    theme/
      css-variables.ts          + --er-hljs-* per scheme (P4-D12)
      theme.css                 − github-dark import, + .hljs-* rules
legacy/                         DELETED in the last commit
```

Route table (`routes.ts`):

```ts
layout('routes/_gated.tsx', [
  layout('routes/_shell.tsx', [
    index('routes/home.tsx'),
    route('history', 'routes/history.tsx'),
    route('jobs/:id', 'routes/jobs.$id.tsx'),
    route('reviews/:id', 'routes/reviews.$id.tsx'),
  ]),
  route('relink', 'routes/relink.tsx'),
  route('api/github/repos', 'routes/api.github.repos.ts'),
  route('api/github/repos/:owner/:repo/pulls', 'routes/api.github.pulls.ts'),
  route('api/github/repos/:owner/:repo/branches', 'routes/api.github.branches.ts'),
  route('api/github/file', 'routes/api.github.file.ts'),
  route('api/jobs/:id', 'routes/api.jobs.$id.ts'),
  route('api/me/jobs/terminal', 'routes/api.me.jobs.terminal.ts'),
]),
route('login', …), route('denied', …), route('auth/github', …), route('auth/github/callback', …),
route('auth/logout', …), route('api/health', …)
```

Resource routes sit under `_gated` so an unauthenticated poll redirects to
`/login` the same way a page does (the fetcher follows it).

---

## 2. Loaders, actions and resource routes

| Route                          | Loader                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Action                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_shell`                       | `{ user, serverNow, polling: { liveMs, terminalMs } }`                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                   |
| `/` (home)                     | `listJobs({ limit: 5 })` + `listJobCreatedAtSince(now − 14 d)` → 14 buckets. Fixes the Phase 0 "Recent always empty" bug by reading through the repository, not a PB rule.                                                                                                                                                                                                                                                                                    | `parseFormData` → `{ target: ReviewTargetSchema (JSON string) }`; `startReview({ userId, token, target })`; `JobInFlightError` → 409 `job_in_flight` + `activeJobId`; `HeadShaResolutionError` → 502; `GithubAuthError` → `redirect('/relink')`; success → `redirect('/jobs/:id')`. |
| `/history`                     | `parseSearchParams` `{ status?: JobStatus }` (anything else → all); `listJobs({ status, limit: 100 })`.                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                   |
| `/jobs/:id`                    | `getJob(id)` → 404 `data(null, 404)` → route `ErrorBoundary` renders the "Review not found" page; `listChunksAfter(id)`; `viewerUserId`.                                                                                                                                                                                                                                                                                                                      | `intent=cancel` → `cancelJob(id, userId, registry)`: `not-cancellable` → 409; `intent=rerun` → `rerunJob`: `JobNotFoundError` 404, `JobInFlightError` 409, `HeadShaResolutionError` 502, `GithubAuthError` → `/relink`; success → `redirect('/jobs/:newId')`.                       |
| `/reviews/:id`                 | `getJob` (404 as above) → not `done` → `redirect('/jobs/:id')` → `getReview` (missing → same redirect) → with the token, if any: PR → `getPullMetadata` + `getPullReviewers`; branch → `getBranchHead` + `synthesizeBranchSummary`; `currentHeadSha !== job.headSha` → `getCommitsAhead`. `MissingToken`/auth failure → all GitHub data `null`, page still renders (as on `main`). `?ch=` and `?file=` parsed with Zod; unknown ids fall back to the summary. | `intent=rerun` — same code path as `/jobs/:id` (shared `rerunAction(request, context, sourceJobId)` helper in `jobs.$id.tsx`, imported by both).                                                                                                                                    |
| `/api/github/repos`            | `withGithub` → `listRepos`; `GithubResult` errors → `data(result, { status })` (403 rate-limited/no-access, 404, 502).                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                   |
| `/api/github/repos/…/pulls`    | `parseParams`; `listOpenPulls`.                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                   |
| `/api/github/repos/…/branches` | `parseParams`; `listRecentBranches` (30-day window as on `main`).                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                                                                                                                                                                   |
| `/api/github/file`             | `parseSearchParams` `{ owner, repo, path, base, head }`; both `getFileAtRef` in parallel (P4-D8).                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                                                                                                                                                                   |
| `/api/jobs/:id`                | `parseSearchParams` `{ after: int ≥ −1, default −1 }`; `getJob` (404) + `listChunksAfter(id, after)` → `{ job: JobView, chunks: ChunkView[] }`.                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                   |
| `/api/me/jobs/terminal`        | `parseSearchParams` `{ since: ISO datetime }`; `listTerminalJobsSince(userId, since)` → `{ now, jobs: JobView[] }`.                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                   |

`JobView` (`lib/job-view.ts`) is the browser-facing job shape: `ReviewJob`
with the `Date` fields as ISO strings, so the same type serves loader data,
polling responses and the list rows without `Date` round-trip surprises.

Error pages: `jobs.$id.tsx` and `reviews.$id.tsx` export an `ErrorBoundary`
that renders the legacy `not-found` copy ("Review not found" / "Back to review
history →") for 404 and defers to the root boundary otherwise.

---

## 3. Component classification (D2)

**Theme only** — Mantine components with props from the theme, no `style`
beyond spacing: `TopbarNav`, `UserMenu` (Menu), `StatusBadge` (Badge),
`FilterChips` (Chip-like Anchors), `EmptyLibrary`, `LoginCard`/`Denied`/
`Relink` (Paper), `InsightCallout` (Box with `borderLeft`), `PeopleCard`
(Paper + dl via `Box component`), `LeadMarkdown`, `RiskScorePill` (Badge),
`RerunButton`, `ReviewBanners` (Alert), `FileView` header, `ChapterCard`
header/meta.

**Mantine + style props** — need `style={{…}}` with `token()` for gradients,
inline geometry or sticky positioning that no Mantine prop expresses:
`Topbar` (sticky + backdrop-filter), `ReviewComposer` (card double shadow,
hairline gradient, CTA gradient), `KindToggle` (SegmentedControl with
`styles`), `TargetCombobox` option rows, `Sparkline` (inline SVG), `JobListRow`
(4-column grid template), `RiskScoreBars`/`RiskSummaryPanel` (bar geometry,
Collapse for the breakdown), `SummaryCard` grid, `ChapterReader` grid with the
`--review-sidebar-width` variable and the drag handle, `JobLiveView` header,
login backdrop radial gradient.

**CSS Module** (P4-D13), each with its reason:

| Module                         | Why a stylesheet                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown-text.module.css`     | Styles are applied to markup react-markdown generates from untrusted model output; descendant selectors (`.root :is(h1,h2)`, `.root pre code`) cannot be expressed as props. Mantine 9 has no `TypographyStylesProvider`. |
| `chapter-sidebar.module.css`   | Sticky column with internal scroll (`max-height: calc(100vh − 6rem)`), the multi-stop gradient overlay on the active file row and `:hover` states on a grid of buttons.                                                   |
| `inline-diff-chunk.module.css` | The Monaco container (`overflow: hidden`, scheme-aware background) and the `.diff-hidden-lines .center` click-target rule that reaches into Monaco's own DOM.                                                             |
| `job-timeline.module.css`      | The absolutely positioned gradient rail, the marker circles at `left: −28px` and the `animate-pulse` streaming cursor — `Timeline` from Mantine is used for structure, the module only paints the rail.                   |

---

## 4. Client state and behaviour

- **Colour scheme:** unchanged (Phase 1, Mantine manager, key `er-theme`).
- **Layout width (P4-D10):** store + `LayoutWidthToggle` (Tabler arrows) +
  `LayoutWidthScript`; `Topbar` inner bar and the reviews `<main>` read
  `var(--review-max-width, 92rem)`.
- **Last target (P4-D10):** `readLastTarget(userId)`, `writeLastRepo` (drops
  pr/branch, keeps kind), `writeLastKind`, `writeLastPull`, `writeLastBranch`,
  `clearLast*`, unchanged semantics; the composer restores in the same three
  steps (repo after repos load, PR after pulls load, branch after branches
  load) and clears the stale part when the stored value is not in the list.
- **Composer data:** three `useFetcher`s, each `.load()`ed lazily (repos on
  mount, pulls/branches once per repo per kind). Errors from the loaders
  surface as notifications with the legacy titles ("Could not load PRs",
  "Could not load branches"); the repos error replaces the picker with the
  inline error box. Submit is a fourth fetcher posting to `/` with the
  target as JSON; 409 shows "Review already running" and the "View running
  review →" ghost link; other `ActionError`s → "Could not start review".
- **Live view:** initial job + chunks from the loader; `usePolling` at
  `liveMs` while the status is in flight, `after` = highest seen `seq`,
  chunks appended and de-duplicated by `seq`. On a terminal status: stop, one
  final `after=-1` refetch (legacy's terminal refresh), and for `done`
  observed live → `navigate('/reviews/:id', { replace: true })` (P4-D2c).
  Cancel (owner + in flight) and Re-run (error/cancelled) are fetcher
  submits with `intent`; the `whatNowFor` hints are ported verbatim.
- **Notifier (`JobNotifications`):** mounted by `_shell`, `usePolling` at
  `terminalMs`, `since` starts at `serverNow` and advances to each
  response's `now`; toasts newly terminal jobs once per id per session,
  suppressed on `/jobs/:id` and `/reviews/:id` of that job; browser
  `Notification` when the tab is hidden and permission is granted.
- **Reader:** `?ch=` / `?file=` via `useSearchParams` (`file` wins),
  `useNarrativeKeyboard` unchanged, sidebar width 256 (208–420) with pointer
  drag + arrow keys, `hideUnchangedRegions` / "Show full file" toggle as on
  `main`.
- **Monaco (A2):** `React.lazy(() => import('@monaco-editor/react').then(m
=> ({ default: m.DiffEditor })))` behind `useHydrated()` with a `Skeleton`
  fallback; `theme` from `useComputedColorScheme()` (P4-D2a). The library's
  default CDN loader is kept (as on `main`).

---

## 5. Commit series

Each commit is green on `npm run check`; integration stays green.

| #   | Commit                                                                                                                                                                                                                                                                                                                                                                                                                               | Screenshot cells sent (P4-D4)                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 0   | This plan.                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                             |
| 1   | **Shell + history.** `_shell.tsx`, `Topbar` (+ nav, user menu, layout-width toggle), stores, `LayoutWidthScript`, env keys, `action-error.ts`, `github.server.ts`, `use-polling.ts`, `use-hydrated.ts`, `job-view.ts`, `JobListRow`/`StatusBadge`/`RiskScorePill`, `history.tsx` (+ empty states), a placeholder `home.tsx` (hero + Recent, no composer yet), `skeleton.tsx` removed, login/denied/relink checked against baselines. | login, denied, history-all, history-filter-done, history-filter-empty                         |
| 2   | **Home.** GitHub resource routes (repos/pulls/branches), `TargetCombobox`, `ReviewComposer`, create action, `RecentReviews` + `Sparkline`.                                                                                                                                                                                                                                                                                           | home-empty, home-pickers, home-pr-picked, home-restored-target, home-409                      |
| 3   | **Live view.** `/api/jobs/:id`, `jobs.$id.tsx` loader/action, `JobLiveView`, `JobTimeline`, `whatNowFor`, `RerunButton`, cancel, auto-open, not-found boundary.                                                                                                                                                                                                                                                                      | jobs-running-1..3, jobs-composing, jobs-cancelled, jobs-error, jobs-done, history-running-row |
| 4   | **Reader.** `reviews.$id.tsx` loader (view-time fan-out, staleness), `ChapterReader`, `ChapterSidebar`, `SummaryCard`, `PeopleCard`, risk components, `ChapterCard`, `InsightCallout`, `LeadMarkdown`, `MarkdownText`, banners, `FileView` (diff placeholder), keyboard hook; ported tests: sidebar, insight, markdown, keyboard.                                                                                                    | reviews-chapter1 (fullpage), summary                                                          |
| 5   | **Inline diff.** `/api/github/file`, `InlineDiffChunk` with lazy Monaco, scheme-aware editor, `--er-hljs-*` tokens; ported inline-diff test.                                                                                                                                                                                                                                                                                         | reviews-chapter1 re-shot with editors                                                         |
| 6   | **Notifier.** `/api/me/jobs/terminal`, `JobNotifications`, browser notifications, "Enable notifications" menu item.                                                                                                                                                                                                                                                                                                                  | history-toast (cross-page)                                                                    |
| 7   | **Close-out.** Delete `legacy/` and its exclusions (`tsconfig.json`, `.oxlintrc.json`, `.prettierignore`), AGENTS.md layout rewrite, overview status, this file's Deviations, RUNNING.md interim block, `legacy/README.md` gone with the directory.                                                                                                                                                                                  | full matrix re-verified                                                                       |

---

## 6. Verification

- `npm run check` and `npm run test:integration` green at every commit.
- Guardrails still pass with the new files: every route registered, no
  `console`, `.server` boundary respected (`stores/`, `lib/action-error.ts`,
  `lib/job-view.ts`, `lib/use-*.ts` ship to the browser), Zod at every
  loader/action boundary.
- Manual, against the running dev server with `REVIEW_EXECUTOR=stub`: sign
  in → pick a real PR → watch the live view → auto-open → read every chapter
  with the keyboard → toggle width and scheme → cancel a second run → see
  the cross-page toast on `/history`.
- Screenshot protocol (P4-D4): same 1280 px Browser pane and cell names as
  Phase 0; composites in `screenshots/compare/`.

## 7. Exit criteria

- All routes in §1 exist and are covered by the tests in P4-D3.
- `legacy/` is gone and nothing references it.
- Every Phase 0 cell has a Phase 4 capture; accepted deltas listed below.
- AGENTS.md describes the Phase 4 tree; overview status says Phase 5 next.

## Deviations

**Commit 1 (shell + history)**

- `JobView` and `toJobView` live in `src/domain/jobs/` (`job-view.ts` shared,
  `toJobView` in `jobs.server.ts`) rather than `src/web/lib/job-view.ts`: the
  conversion needs `ReviewJob`, a `.server` type, and the domain is where the
  read side already lives. A browser-safe `status.ts` (`JOB_STATUSES`) was added
  for the same reason — only `src/db` may import the Prisma enum.
- `usePolling` uses a plain `setInterval` in an effect (plus Mantine's
  `useDocumentVisibility`) instead of `useInterval`; the ticks are the same.
- `JobListRow` is a Mantine `NavLink` so the hover tint comes from the theme
  (`--mantine-color-default-hover` → `muted`) without a stylesheet; rows are
  ~1 px taller than `main`.
- The topbar brand's hover rotate (`-3deg`) and the nav pill's hover text
  colour are not reproduced (no hover styles without a stylesheet).
- Home ships in commit 1 as hero + Recent (the composer arrives in commit 2)
  so the index route is never a placeholder page.
- Screenshots were taken through the Playwright browser signed in with a
  locally minted session (`screenshots/tools/dev-session.ts`, gitignored)
  because the GitHub OAuth consent click cannot be automated; the DB was
  empty after the integration suite's `resetDb`, so five jobs were seeded the
  same way for the list cells.

**Commit 2 (home composer)**

- The persisted last-target store _is_ the composer's selection state: every
  pick writes to it and the current repo/PR/branch is derived from it against
  the fetched lists, so no effect sets React state (oxlint
  `react/set-state-in-effect`) and a reload restores the target for free. The
  store uses `skipHydration` and the composer rehydrates after mount, so SSR
  and hydration agree on the empty composer.
- The three `/api/github/*` resource routes _return_ failures
  (`{ ok: false, error, message }` with a status from `GITHUB_ERROR_STATUS`)
  instead of throwing, so a rate limit degrades one picker rather than tripping
  the page's error boundary; only a rejected token throws (the `/relink`
  redirect). The pulls/branches bodies echo `fullName` so a stale fetcher body
  for a previous repo reads as "not loaded".
- The create action is posted to `/?index` (a bare `/` would target the
  layout route, which has no action).
- Option rows are 13 px with a secondary line (author · head → base, or the
  tip commit message) where `main` showed a single line; the PR trigger
  truncates the title with an ellipsis where `main` clipped it.
- Screenshots: the browser never holds a real GitHub token. The
  `/api/github/*.data` requests were fulfilled by Playwright with
  turbo-stream-encoded fixture bodies (`screenshots/tools/github-fixtures.ts`,
  gitignored) and a signed _placeholder_ `gh_access_token` cookie let the
  create action run; with a running job seeded it answered 409 for real, and
  without one GitHub rejected the placeholder and the page landed on `/relink`
  with the cookie cleared — the P4-D7 path, verified end to end.

**Commit 3 (live view)**

- `rerunAction` lives in `src/web/lib/rerun-action.server.ts`, not as an
  extra export of `jobs.$id.tsx`: React Router ships a route module's
  non-route exports to the browser, and the helper imports server-only code
  (the build refused it). The generic error page moved to
  `components/app-error.tsx` for the same reason — a route boundary cannot
  import `root.tsx` without dragging the session middleware client-side.
- The live view polls with plain `fetch` + `res.json()` against the resource
  route (which returns JSON for a direct request) rather than a `useFetcher`,
  because the incremental chunk merge has to update state from the poll
  callback; a fetcher would need an effect that sets state on `fetcher.data`
  (oxlint `react/set-state-in-effect`). Ticks are serialised (a slow poll is
  not overlapped) and the terminal transition triggers one `after=-1` refetch
  before the `done` → `/reviews/:id` replace.
- `getJob` treats a non-UUID id as not found: Postgres rejects the cast and
  Prisma threw, turning `/jobs/nope` into a 500 instead of the 404 page.
- The phase derivation (`live-phases.ts`) and `whatNowFor` are pure modules
  with unit tests; two legacy quirks are kept knowingly — the in-progress
  title counts toward "N chapters so far", and an error message starting with
  `github` matches the `git` branch ("Clone failed") because `main` tests the
  prefixes in that order.
- Verification ran on a second dev server (port 3001, `web-3001` in the local
  `.claude/launch.json`) because the long-running port-3000 server did not
  reload its route manifest for the new route files; its boot recovery
  errored the seeded in-flight jobs once, as designed (`bootJobs`).

**Commit 4 (reader)**

- The view-time GitHub fan-out lives in `lib/review-metadata.server.ts`
  (`loadReviewMetadata`), not inline in the loader, so it is unit-tested
  against mocked domain calls. It reads the token with `readGithubToken`
  rather than `requireGithubToken`: the reader must render without a token
  (and when GitHub rejects one), as on `main`. PR metadata and reviewers are
  fetched in parallel instead of sequentially.
- `reviews.$id.tsx` exports `shouldRevalidate` returning false for a
  search-param-only navigation. `?ch=` / `?file=` are client-side section
  switches over data the page already holds; without it every sidebar click
  re-ran the loader and its GitHub calls (the Next page did the same, as an
  RSC refetch). The keyboard hook's heading focus retries for a few frames
  because the new heading mounts on that navigation.
- `LeadMarkdown` drops the legacy `size` prop: the inner markdown `text-sm`
  always won, so `main` rendered leads at 14px serif and that is what the
  port matches (the 18px design intent never reached the screen).
- `InlineDiffChunk` is a placeholder that lists the selected hunk ranges
  (`formatSelectedHunkLabel`); commit 5 replaces its body with the Monaco
  diff. `FileView` and `ChapterCard` therefore drop the `owner/repo/baseRef/
headRef` props until then.
- `JobNotFound` moved to `components/jobs/job-not-found.tsx` so both route
  boundaries import a component rather than one route importing another
  route module. The 404 page renders inside the shell (topbar visible) on
  both routes, where `main` rendered it bare.
- `ChapterSidebar` keeps the legacy props (`reviewTitle` is accepted, unused)
  and its four ported tests; the unused `sublabel` plumbing was not ported.
  The sidebar and reader grid use CSS Modules for the active-row wash, the
  hover states and the 64em breakpoint (Tailwind's `lg`), which Mantine's
  breakpoints do not match.
- Verification could not exercise the GitHub-backed sections (branch refs
  line, reviewers, author description, staleness banner): the local browser
  carries a placeholder token, so the fan-out degrades to the job byline.
  Those paths are covered by `review-metadata.server.test.ts` and the
  markdown/people components' unit tests. The truncation banner was verified
  with a seeded `diff_truncated` review.
