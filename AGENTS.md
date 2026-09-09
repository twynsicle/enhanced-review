# Repo orientation for agents

Web-based AI code-review tool. Sign in with GitHub, pick a repo + PR/branch,
the server clones it, runs the Claude Agent SDK against it, and streams a
chaptered narrative review back. Successor to the diffy POC.

This file is the map of the tree for anyone changing it. `README.md` is the
product-and-setup document; `docs/OPERATIONS.md` is the runbook for a running
deployment.

Library APIs here (React Router 8, Mantine 9, Prisma 7, remix-auth 4, Vite 8,
Vitest 4, Zod 4, TypeScript 7, oxlint) may be newer than your training data.
Check the package's docs in `node_modules/<pkg>` or the current online docs
before writing code against them; heed deprecation notices.

## Tech stack

- Node 24 (Volta-pinned, `engines >=24`). The Express server and the jobs CLI
  run TypeScript directly via Node's type stripping — no build step for
  `server/` or `src/jobs/`.
- React Router 8 framework mode (SSR) on Vite 8; Express 5 via
  `@react-router/express` in `server/index.ts`. Single process: the review
  runner lives in-process, so never run under a forking manager.
- React 19, Mantine 9 (core/hooks/notifications/form/dates), Tabler icons,
  Zustand for persisted client prefs, Zod 4 at every boundary.
- Prisma 7 + `@prisma/adapter-pg` (engine-free) on Postgres 18. Client is
  generated into `src/db/generated/` (gitignored) by `postinstall`. Polling
  instead of realtime.
- Auth: remix-auth 4 + remix-auth-github 3 redirect flow; DB-backed sessions
  via React Router `createSessionStorage`; GitHub token only in an HttpOnly
  cookie.
- Pino logging (`src/common/logger.ts`); `console.*` is banned by guardrail.
- TypeScript 7 (native compiler) strict, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`. Linting is **oxlint** (`.oxlintrc.json`) — TS 7 has
  no JS API, so typescript-eslint cannot run against it. Prettier formats.
- Vitest 4 projects: `unit` (node), `web` (happy-dom), `guardrails`
  (repo-reading convention tests), `integration` (real Postgres, self-skips).

## Repo layout

```
server/index.ts        Express bootstrap: dev = Vite middleware, prod = build/; SIGTERM/SIGINT → abortAll('shutdown') + drain, then close
prisma/
  schema.prisma        5 models (users, sessions, review_jobs, reviews, review_chunks) + JobStatus
  migrations/          0001_init (hand-added CHECK constraints), 0002_drop_allowed_users,
                       0003_drop_github_login_unique (logins are reusable; identity is github_id)
prisma.config.ts       Prisma CLI config; loads .env, datasource url from DATABASE_URL
src/
  common/              logger.ts (pino), time-ago.ts — imports only config from src/
  config/              env.ts — Zod-parsed process.env, the only process.env reader; load-env.ts — loads .env for native entry points;
                       host-env.ts — hostEnv()/pickHostEnv() for code that spawns subprocesses
  db/                  client.ts (PrismaClient singleton, pingDb), users.ts, sessions.ts, allowed-users.ts,
                       review-jobs.ts (conditional status transitions, lists, health counts), reviews.ts, review-chunks.ts,
                       generated/ (gitignored). JSON columns come back `unknown`; domain parses them.
  domain/              shared by server and browser; *.server.ts marks the server-only modules (see Layering)
    auth/              github-profile.server.ts (GET /user, Zod), sign-in.server.ts (upsert user)
    github/            all *.server.ts on one @octokit/core instance per request: client (createOctokit, GithubAuthError,
                       classifyGithubError, toResult), repos, pulls, branches (GraphQL), resolve-target (re-pin SHAs),
                       pull-metadata (runner), view-time (getFileAtRef, getBranchHead, getCommitsAhead); types.ts shared
    review/            shared: narrative.ts (NarrativeReview Zod schema + types), target.ts (ReviewTarget schema, describeTarget),
                       language-map.ts, partial-narrative-parse.ts (live-view checklist), inline-diff-snippets.ts (reader maths)
      clone/           *.server.ts: git-runner (spawn, non-interactive, abort → SIGTERM), clone-runner (init + fetch head +
                       verify SHA + fetch base + diff; headRefFor, githubCloneUrl), diff-files (listChangedFiles/mergeFileLists)
      prompt/          pure: ai-file-filter, diff-hunk-catalog (H0001… ids), narrative-prompt (system + user, truncation),
                       parse-narrative (lenient sanitising, validated by NarrativeReviewSchema), types.ts (PrData)
      executor/        types.ts (ReviewExecutor, errors); stub-executor.server.ts (STUB_REVIEW in fragments);
                       claude-executor.server.ts (Agent SDK, read-only tools, sandbox, settingSources: [], env allowlist)
      run.server.ts    runJob(input, deps) → 'done' | 'skipped' | 'aborted' | 'errored'; defaultRunJobDeps(); formatJobError
    jobs/              all *.server.ts: registry (AbortControllers on globalThis[JOBS_REGISTRY_KEY]), timeout (armTimeout),
                       start-review (startReview / rerunJob / launchJob), cancel-job, recover-jobs, boot (bootJobs, once per process),
                       jobs (read side: parseJob/parseReview, getJob (non-UUID → null), listJobs, getReview, listChunksAfter,
                       listRecentActivity, toJobView);
                       shared: errors.ts (JobInFlightError, …), status.ts (JOB_STATUSES), job-view.ts (JobView, jobHref), activity.ts
  jobs/                cli.ts (`npm run job -- <name>`), recover-jobs.ts, errors.ts
  guardrails/          *.guard.test.ts — layering, env-access, no-console, routes-registered, zod-boundaries, server-only, prisma-access,
                       palette (token contrast maths + the type scale and one-label rules)
  test/                integration-global-setup.ts (Postgres probe → provide dbAvailable), db.ts (describeDb, resetDb)
  web/
    root.tsx           Layout, MantineProvider, ColorSchemeScript, ErrorBoundary, middleware: [sessionMiddleware]
    entry.server.tsx   RR server entry (`reveal` default, logger instead of console); awaits bootJobs() before the first request
    routes.ts          route table — every file in routes/ must be listed here
    routes/            _gated.tsx (layout: requireUser) → _shell.tsx (layout: Topbar + JobNotifications; loader {user, serverNow, polling})
                         → home.tsx (index: hero + ReviewComposer + Recent; action POST /?index → startReview), history.tsx (?status=),
                           jobs.$id.tsx (live view; loader job + chunks, 404 → own ErrorBoundary; action intent=cancel|rerun),
                           reviews.$id.tsx (reader; loader: done job + review + GitHub fan-out via lib/review-metadata.server,
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
    components/        brand-mark, caption (the one uppercase label), page-shell (the one page width,
                       shared with the topbar), color-scheme-toggle,
                       app-error (generic error page, used by root + route boundaries);
                       topbar/ (topbar, topbar-nav, user-menu, layout-width-toggle),
                       jobs/ (job-list-row, status-badge, job-live-view (fetch-polls api/jobs/:id, cancel fetcher),
                       job-timeline (+ .module.css: rail/markers), live-phases (pure derivePhases/eyebrow/heading),
                       what-now, rerun-button, job-not-found (404 page shared with the reader)), history/ (filter-chips,
                       empty-history), home/ (review-composer, target-combobox, recent-reviews, sparkline),
                       narrative/ (the reader: chapter-reader (+ .module.css grid, resizable sidebar, ?ch=/?file= state),
                       chapter-sidebar (+ .module.css), chapter-card, summary-card, file-view, insight-callout,
                       article.module.css (the reading measure + the diff bleed lane),
                       lead-markdown, markdown-text (+ .module.css; react-markdown + gfm + rehype-highlight),
                       inline-diff-chunk (+ .module.css; useFetcher → /api/github/file, snippets per hunk group,
                       lazy Monaco DiffEditor behind useHydrated, vs/vs-dark follows the scheme), review-banners, risk-score,
                       use-narrative-keyboard), notifications/ (job-notifications: fetch-polls api/me/jobs/terminal with
                       a 30 s overlap, toasts once per job id, suppressed on that job's pages, browser Notification when
                       hidden + granted) — all browser-safe, styled via token() or a sibling CSS Module
    stores/            Zustand, persisted: layout-width.ts (`er-layout`, bindLayoutWidth), last-target.ts (`er:last-target`, per user)
    theme/             Editorial Iris tokens.ts (palette + per-scheme highlight.js colours + FONT_SIZES/DISPLAY_SIZE/
                       CAPTION_TYPE, the type scale) → theme.ts (Mantine ramps, fontSizes, sans + mono),
                       css-variables.ts (--er-* and --er-hljs-* vars), color-scheme.ts, theme.css (base + .hljs-* rules)
    lib/               parse.server.ts (Zod parseParams / parseSearchParams / parseFormData), github.server.ts (requireGithubToken,
                       withGithub → /relink, githubFailure), github-api.ts (resource-route body types, GITHUB_ERROR_STATUS),
                       jobs-api.ts (JobPollResponse, TerminalJobsResponse, mergeChunks), rerun-action.server.ts (shared
                       intent=rerun handler),
                       review-metadata.server.ts (reader's view-time GitHub fan-out: PR header or branch head,
                       staleness compare; every section degrades on its own, no token → nothing fetched),
                       action-error.ts (ActionError + actionError()), use-polling.ts, use-hydrated.ts
    test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper
public/                Passage brand-mark.svg (+ PNG export), favicon.svg / favicon.ico (tighter padding for small sizes),
                       apple-touch-icon.png
docs/OPERATIONS.md     runbook for a running deployment
Dockerfile             node:24-alpine multi-stage; build stage runs prisma generate; runtime ships source + prod deps
entrypoint.sh          the image's CMD: prisma migrate deploy → recover-jobs → exec node server/index.ts
docker-compose.yml     postgres:18-alpine on 127.0.0.1:5432 + `web` (the app as it ships, on :3000, behind the `app` profile)
.github/workflows/ci.yml  check: postgres → npm ci → db:deploy → check:all; image: docker build → boot → /api/health
```

Layering (enforced by `src/guardrails`): `web → domain, db, common,
config`; `domain → db, common, config`; `db → common, config`;
`jobs → domain, db, common, config`; `common → config`; `config` imports
nothing from `src/`. Only `src/web/` and `server/` may import React or
`react-router`. `db` and `config` are server-only; `domain` is **shared**
between server and browser, and a domain module that imports `db`, `config`,
the logger, a `node:` builtin, a server-only package (`@octokit/*`, the Claude
SDK, `pg`, `pino`) or another `.server` module must be named `*.server.ts` —
rule of thumb: name it `.server.ts` unless the browser is meant to import it.
Inside `web`, only route modules, `root.tsx`, `entry.server.tsx` and
`*.server.ts` files may import those server-only things; everything else in
`web` ships to the browser and may import only non-`.server` domain modules
and `common`. Only `src/db/` may import `@prisma/*` or the generated client
(guardrail `prisma-access`).

## How auth works

- `POST /auth/github` → remix-auth redirects to GitHub (`repo` scope, state in
  the `er_oauth` cookie). `GET /auth/github/callback` exchanges the code, the
  verify callback fetches `/user` and upserts `users` keyed on `github_id`,
  then the route mints a `sessions` row and sets two signed HttpOnly cookies:
  `er_session` (session id, 7 days) and `gh_access_token` (90 days). **The
  GitHub token is never written to the database.**
- Root middleware (`sessionMiddleware`) loads the session + user into route
  context on every request and rolls the session (row + cookie) once less than
  half its lifetime remains. It never redirects.
- Protected pages nest under `routes/_gated.tsx`, whose `requireUser`
  middleware requires a signed-in user; anyone else has their session deleted
  and both cookies cleared, and is redirected to `/login`. Public routes live
  outside the layout. Gated pages must export a loader so the chain runs.
  **Signing in with GitHub is the only condition for access** — the
  `allowed_users` allowlist and the `/denied` page are gone, so whatever
  fronts the deployment is the access control.
- `POST /auth/logout` uses the same `signOutHeaders`. `/relink` (gated)
  re-runs the OAuth flow when the token cookie is missing/rejected.
- Authorisation is explicit in loaders and actions: any signed-in user may
  read any job or review, only the owner may cancel one.

## How a review runs

- **Create / rerun** (`domain/jobs/start-review.server.ts`): refuse when the
  user already has `MAX_JOBS_PER_USER` jobs in flight (`JobInFlightError`),
  re-pin the target's SHAs against GitHub with the caller's token
  (`GithubAuthError` passes through for `/relink`; anything else is
  `HeadShaResolutionError`), insert a `pending` row, then `launchJob`:
  register an `AbortController`, arm the `REVIEW_TIMEOUT_MIN` timeout and
  run `runJob` fire-and-forget. A rerun copies the source target, is owned by
  the viewer and is pinned to the current head.
- **Runner** (`domain/review/run.server.ts`): `markRunning` (conditional
  `pending → running`; false means cancelled before start) → PR metadata →
  init + shallow fetch of `pull/N/head` or the branch → verify the head SHA
  still matches → fetch the base SHA → diff + changed files → executor. The
  executor streams raw text; each fragment becomes a `review_chunks` row
  (`seq` from 0, inserts fire-and-forget, drained before finalize).
  `finalizeDone` writes the `reviews` row and `running → done` in one
  transaction. Failures → `markErrored(formatJobError(err))`, clipped to 500
  chars. Every side effect is injected (`RunJobDeps`) so the stub review runs
  end to end from `run.integration.test.ts` against a local git repo.
- **Abort reasons** say who already wrote the terminal status: `cancel`
  (`cancel-job.server.ts` wrote `cancelled` before signalling), `timeout`
  (`timeout.server.ts` wrote `error` first), `shutdown` (nobody — the runner
  writes `error: interrupted: server shutting down`).
- **Executors**: `REVIEW_EXECUTOR=stub` replays `STUB_REVIEW` in fragments
  (local default, all tests); `claude` runs the Agent SDK in the clone with
  read-only tools, the filesystem sandbox pinned to the clone,
  `settingSources: []` (the reviewed repo's `.claude/` cannot register hooks),
  `persistSession: false` and only `CLAUDE_ENV_KEYS` from the host env.
- **Process lifecycle**: `entry.server.tsx` awaits `bootJobs()` once per
  process, which flips orphaned `pending|running` rows to `error`
  ("interrupted: server restarted"); `npm run job -- recover-jobs` does the
  same by hand. `server/index.ts` handles SIGTERM/SIGINT: `abortAll('shutdown')`
  on the registry (reached through `globalThis[JOBS_REGISTRY_KEY]`, since the
  bootstrap sits outside Vite's module graph), `drain` for up to 5 s, then
  close. `/api/health` reports `queueDepth`, `oldestPendingAgeSec`,
  `errorsLast24h`.
- **Reads** go through `domain/jobs/jobs.server.ts`, which parses the JSON
  columns (`target` → `ReviewTargetSchema`, `content` →
  `NarrativeReviewSchema`); repositories return them as `unknown`.

## Design system

Two rules, both enforced by the `palette` guardrail, both the result of the
reader growing twelve font sizes and nine near-identical label styles:

- **Six font sizes, no more.** `FONT_SIZES` (Mantine's `xs`–`xl`: 11/13/15/19/28)
  plus `DISPLAY_SIZE` (40) for page and chapter titles. Use `fz="sm"` or
  `var(--mantine-font-size-sm)`, never a literal `fz={13}` or `font-size: 13px`.
- **One uppercase label.** `components/caption.tsx`; it varies only by `tone`.
  A component that needs the treatment without the component (a Mantine
  `Badge`, say) reads `CAPTION_TYPE` rather than respelling the values.

**One reading measure.** In the reader, every block — heading, card, prose,
caption — sits in a single column capped at `--er-measure` (42rem) via
`narrative/article.module.css`, so they share one right edge. Only a diff or a
code block opts out, with `data-bleed`, and spans the rest of the column: those
are the only things here that read better wide, and they are what the
wide-layout toggle is for. Do not give a prose block its own `max-width` — that
is what had text wrapping near the middle of a much wider card, lined up with
nothing.

Two widths on the page, and no more: the measure, and the full column. A third
lane sized between them — cards ending somewhere after the prose but before the
diffs — reads as confusion rather than hierarchy. That is why card grids
(insights, risk factors) stack in one column instead of widening: measured on a
real review, stacking cost 131px on six risk factors and _saved_ 96px on the
insights, because a full-measure card wraps to fewer lines and a two-up grid
equalises its rows to the tallest cell.

**One page width.** Every page inside the shell renders through
`components/page-shell.tsx`, which is also where the topbar's inner bar gets
its `maw` and `px`, so the header lines up with the page beneath it and the
narrow/wide toggle moves both. Widening the shell is not the same as widening
the text: prose keeps its own measure in `ch`, and a page whose content gains
nothing from the extra room (the job timeline) caps itself and stays
left-aligned so the left edge never jumps between pages. Do not reintroduce a
per-route `Container size={...}` — that is what made the toggle look broken
everywhere outside the reader. `PageShell` pads the bottom more than the top
(`SHELL_PB`): a page that ends flush with its last element reads as cut off.

Two text families: sans for everything, mono for identifiers, paths, SHAs and
code. There is no display serif.

Colour is semantic tokens only (`token('muted-foreground')`, never a literal or
a `color-mix` off `foreground`). Body text is `foreground`; anything secondary
is `muted-foreground` — those two greys are the whole vocabulary. `subtle` is
placeholder and decoration, never text. Text on a `-soft` fill takes the
matching `-ink`. `border` draws cards and dividers; `border-strong` (≥ 3:1) is
for control boundaries and is what Mantine's `default-border` resolves to.

**Every token that carries text clears WCAG AA against all four grounds of its
own scheme — `background`, `card`, `surface-2` and `muted` — every `-ink`
clears AA on its own `-soft`, and every token is inside the sRGB gamut.** All
four grounds, not just the page: a colour fitted only against `background`
fails the moment it lands on a chip or a list row, which is how the filter
chips shipped at 4.37:1. The two schemes therefore hold different accent
values — a mint that reads on a dark card cannot also read on white, which is
how the previous palette came to fail light mode. When changing a colour, run
`npm test` and let the guardrail do the arithmetic. Disabled controls are
exempt (WCAG 1.4.3) and the guardrail does not look at them.

## Conventions

- Path alias `@/*` → `src/*` is used in `src/web/` (bundled by Vite).
  Everything Node may load natively — `server/`, `src/config`, `src/common`,
  `src/db`, `src/domain`, `src/jobs` — uses relative imports with explicit
  `.ts` extensions.
- Server-only modules use the React Router `*.server.ts` filename convention
  — `db`/`config` by location, `domain` and `web` by filename.
- `process.env` is read only in `src/config`. Code that spawns a subprocess
  gets the environment from `src/config/host-env.ts`.
- `src/db/client.ts` owns the Prisma lifecycle (globalThis singleton for Vite
  HMR, disconnect on SIGTERM/SIGINT). `server/index.ts` does not import it.
- Every loader/action parses `params`, search params and form data with Zod
  via `src/web/lib/parse.server.ts` (guardrail `zod-boundaries`).
- Env vars: add to the schema in `src/config/env.ts` **and** to `.env.example`
  in the same commit; add a test default in `vitest.config.ts` if required.
  Local values live in `.env` (gitignored).
- Schema changes: edit `prisma/schema.prisma`, `npm run db:migrate` (creates
  the migration and regenerates the client). Prisma 7 does not regenerate on
  migrate by itself.
- Integration tests: `*.integration.test.ts`, wrap in `describeDb` from
  `src/test/db.ts`, call `resetDb()` in `beforeEach`. Files run serially.
- No barrel `index.ts` files. Import the module you need
  (`@/web/theme/theme`, not `@/web/theme`).

## Scripts

| Script                                     | What                                                           |
| ------------------------------------------ | -------------------------------------------------------------- |
| `npm run dev`                              | Express + Vite dev server on `localhost:3000`                  |
| `npm run build` / `npm start`              | `react-router build` / serve `build/` in production mode       |
| `npm run typecheck`                        | `react-router typegen && tsc --noEmit`                         |
| `npm test` / `test:watch`                  | Vitest `unit` + `web` + `guardrails`                           |
| `npm run test:integration`                 | Vitest `integration` (needs Postgres; skips when unreachable)  |
| `npm run lint` / `format` / `format:check` | oxlint / Prettier                                              |
| `npm run check`                            | **The gate**: typecheck + build + test + lint + format:check   |
| `npm run check:all`                        | `check` + integration                                          |
| `npm run db:migrate`                       | `prisma migrate dev && prisma generate` (local schema changes) |
| `npm run db:deploy` / `db:reset`           | apply migrations (CI/containers) / drop + reapply + generate   |
| `npm run db:generate` / `db:studio`        | regenerate client (also `postinstall`) / Prisma Studio         |
| `npm run job -- <name> [args]`             | one-shot jobs, natively: `recover-jobs`                        |

## Container

One image, one process. `docker compose up -d` is all day-to-day dev needs:
it starts Postgres alone, because `web` is behind the `app` profile.
`docker compose --profile app up --build` runs the app as it ships on `:3000`.
The profile exists because that port is also `npm run dev`'s — a bare `up`, a
`restart` or Docker Desktop's start button used to raise a container built from
whatever the tree held at image-build time, which silently beat the dev server
to the port and served a stale build. Compose enables a profile automatically
when a command names the service, so `run --rm web …` and `logs web` need no
flag. CI builds the image with plain `docker build` and is unaffected. `entrypoint.sh` is the image's **CMD**, not its entrypoint,
so `docker run <image> node src/jobs/cli.ts <job>` replaces the start-up
chain instead of appending to it.

The runtime stage ships **source, not a bundle**: the server and the jobs CLI
are TypeScript that Node runs directly, so everything they import has to be
copied into the image — `server/`, `src/{config,common,db,domain,jobs}/`,
`prisma/`. Adding an import that reaches a directory not on that list breaks
the container without breaking `npm run dev`, which is exactly how an earlier
image came to build and not boot.

The opposite trap applies to packages. `@tabler/icons-react`,
`@monaco-editor/react`, `monaco-editor` and `@fontsource/*` are
**devDependencies** bundled into `build/server` by `ssr.noExternal`, so the
image never installs them. Importing one from a module that runs on the server
at runtime, rather than through the bundle, fails only in the container.

## Environment

`.env.example` is the canonical list with comments. Required: `DATABASE_URL`,
`SESSION_SECRET` (≥ 32 chars), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`APP_ORIGIN`. Optional: `NODE_ENV`, `PORT`, `APP_VERSION`, `LOG_LEVEL`
(`silent` allowed), `LOG_PRETTY`, and the review runner's `REVIEW_EXECUTOR`
(`stub | claude`, default `claude`), `REVIEW_MODEL`, `REVIEW_TIMEOUT_MIN`,
`MAX_JOBS_PER_USER`, `ANTHROPIC_API_KEY`, and the browser polling cadence
`LIVE_POLL_MS` / `TERMINAL_POLL_MS`. `vitest.config.ts` fills
placeholders for the required keys and forces `REVIEW_EXECUTOR=stub` so
`npm run check` runs without a `.env` and never calls the SDK.

## Working on Windows

The user runs Windows. `bash` (Git Bash) and `powershell` are both available.
When you suggest commands, use forward-slash paths and POSIX-friendly syntax.
Line endings are normalised to LF by `.gitattributes`.

## Keeping this file up to date

Treat AGENTS.md as a living map. **Update it in the same change that
introduces structural drift, then commit the AGENTS.md edit with that
change.** Triggers:

- New top-level directory, or a new `src/<area>` / `src/web/routes/<route>`.
- A new Prisma model or a rule change on how one is accessed.
- A new env var, npm script, executor backend, job, or guardrail.
- Renames or removals of any of the above.
- A change to the high-level data flow (auth, job lifecycle, polling).

Pure refactors inside an already-named area do **not** require an update.

1. If `AGENTS.md` is part of the diff, include it in the same commit as the
   code change that triggered it. Do not split it into a separate docs commit.
2. If you notice AGENTS.md is stale relative to the tree, fix it in your next
   commit on the branch.
3. Commit message convention: follow whatever style `git log -n 5` shows.
4. Don't push without explicit user approval. Local commits are fine;
   remote-visible actions are not.
