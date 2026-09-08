# Repo orientation for agents

> **Migration in progress (React Router re-platform).** The app is being
> rebuilt phase by phase on `migrate-react-router`; it is **not runnable
> end-to-end until Phase 4 lands**. The plan of record is
> `docs/rr-migration/00-overview.md` — read it before anything else. Phase
> plans (`phase-N-plan.md`) say what each phase built and what it deviated on.
> Phases 0–3 are done: the skeleton, Postgres/Prisma, GitHub sign-in, sessions
> and the allowlist gate work, and the review runner + job lifecycle exist as
> a service (`src/domain/review`, `src/domain/jobs`) with no UI on top yet.
> `README.md`, `docs/RUNNING.md` and `docs/OPERATIONS.md` still describe the
> old Next.js + PocketBase app and are rewritten in Phase 6 (RUNNING.md has an
> interim block for running the current state).

Web-based AI code-review tool (closed beta). Sign in with GitHub, pick a repo +
PR/branch, the server clones it, runs the Claude Agent SDK against it, and
streams a chaptered narrative review back. Successor to the diffy POC.

Library APIs here (React Router 8, Mantine 9, Prisma 7, remix-auth 4, Vite 8,
Vitest 4, Zod 4, TypeScript 7, oxlint) may be newer than your training data.
Check the package's docs in `node_modules/<pkg>` or the current online docs
before writing code against them; heed deprecation notices.

## Authoritative docs — read these first

| File                                | When to read                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `docs/rr-migration/00-overview.md`  | Locked decisions (D1–D13), assumptions, target layout, phases, risks.     |
| `docs/rr-migration/phase-N-plan.md` | What each phase built, its decisions (PN-Dx), deviations, exit criteria.  |
| `legacy/README.md`                  | Map from the quarantined old code to where each piece is ported.          |
| `README.md`, `docs/*.md`            | **Stale** (PocketBase era) until Phase 6. Use only for product behaviour. |

## Tech stack

- Node 24 (Volta-pinned, `engines >=24`). The Express server and the jobs CLI
  run TypeScript directly via Node's type stripping — no build step for
  `server/` or `src/jobs/`.
- React Router 8 framework mode (SSR) on Vite 8; Express 5 via
  `@react-router/express` in `server/index.ts`. Single process: the review
  runner (Phase 3) lives in-process, so never run under a forking manager.
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

## Repo layout (Phase 3 state)

```
server/index.ts        Express bootstrap: dev = Vite middleware, prod = build/; SIGTERM/SIGINT → abortAll('shutdown') + drain, then close
prisma/
  schema.prisma        6 models (users, sessions, allowed_users, review_jobs, reviews, review_chunks) + JobStatus
  migrations/          0001_init (hand-added CHECK constraints)
prisma.config.ts       Prisma CLI config; loads .env, datasource url from DATABASE_URL
src/
  common/              logger.ts (pino), time-ago.ts — imports only config from src/
  config/              env.ts — Zod-parsed process.env, the only process.env reader; load-env.ts — loads .env for native entry points;
                       host-env.ts — hostEnv()/pickHostEnv() for code that spawns subprocesses
  db/                  client.ts (PrismaClient singleton, pingDb), users.ts, sessions.ts, allowed-users.ts,
                       review-jobs.ts (conditional status transitions, lists, health counts), reviews.ts, review-chunks.ts,
                       generated/ (gitignored). JSON columns come back `unknown`; domain parses them.
  domain/              shared by server and browser; *.server.ts marks the server-only modules (see Layering)
    auth/              github-profile.server.ts (GET /user, Zod), sign-in.server.ts (upsert user), allowlist.server.ts (isAllowed, fails closed)
    github/            all *.server.ts on one @octokit/core instance per request: client (createOctokit, GithubAuthError,
                       classifyGithubError, toResult), repos, pulls, branches (GraphQL), resolve-target (re-pin SHAs),
                       pull-metadata (runner), view-time (getFileAtRef, getBranchHead, getPullReviewers, getCommitsAhead); types.ts shared
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
                       jobs (read side: parseJob/parseReview, getJob, listJobs, getReview, listRecentActivity, toJobView);
                       shared: errors.ts (JobInFlightError, …), status.ts (JOB_STATUSES), job-view.ts (JobView, jobHref), activity.ts
  jobs/                cli.ts (`npm run job -- <name>`), seed-allowlist.ts, recover-jobs.ts, errors.ts
  guardrails/          *.guard.test.ts — layering, env-access, no-console, routes-registered, zod-boundaries, server-only, prisma-access
  test/                integration-global-setup.ts (Postgres probe → provide dbAvailable), db.ts (describeDb, resetDb)
  web/
    root.tsx           Layout, MantineProvider, ColorSchemeScript, ErrorBoundary, middleware: [sessionMiddleware]
    entry.server.tsx   RR server entry (`reveal` default, logger instead of console); awaits bootJobs() before the first request
    routes.ts          route table — every file in routes/ must be listed here
    routes/            _gated.tsx (layout: allowlistGate) → _shell.tsx (layout: Topbar; loader {user, serverNow, polling})
                         → home.tsx (index: hero + ReviewComposer + Recent; action POST /?index → startReview), history.tsx (?status=)
                       _gated (chrome-less) → relink.tsx, api.github.repos.ts, api.github.pulls.ts, api.github.branches.ts
                         (resource routes the composer loads via useFetcher; bodies typed in lib/github-api.ts, failures
                         returned with a status, rejected token → /relink);  public: login.tsx, denied.tsx, auth.github.ts,
                       auth.github.callback.ts, auth.logout.ts, health.ts.  Phase 4 adds jobs.$id, reviews.$id, api/jobs/:id,
                       api/github/file and api/me/jobs/terminal.
    auth/              *.server.ts: cookies, session (createSessionStorage + rolling), authenticator (remix-auth),
                       context (userContext/sessionContext), session-middleware, gate-middleware (allowlistGate, signOutHeaders)
    components/        brand-mark, color-scheme-toggle; topbar/ (topbar, topbar-nav, user-menu, layout-width-toggle),
                       jobs/ (job-list-row, status-badge), history/ (filter-chips, empty-library),
                       home/ (review-composer, target-combobox, recent-reviews, sparkline), narrative/ (risk-score) —
                       all browser-safe, styled via token()
    stores/            Zustand, persisted: layout-width.ts (`er-layout`, bindLayoutWidth), last-target.ts (`er:last-target`, per user)
    theme/             Editorial Iris tokens.ts → theme.ts, css-variables.ts (--er-* vars), color-scheme.ts, theme.css
    lib/               parse.server.ts (Zod parseParams / parseSearchParams / parseFormData), github.server.ts (requireGithubToken,
                       withGithub → /relink, githubFailure), github-api.ts (resource-route body types, GITHUB_ERROR_STATUS),
                       action-error.ts (ActionError + actionError()), use-polling.ts, use-hydrated.ts
    test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper
legacy/                READ-ONLY old code awaiting port; excluded from every tool. Deleted end of Phase 4.
public/                brand-mark.png, favicon.ico
docs/rr-migration/     plan of record
Dockerfile             node:24-alpine multi-stage; build stage runs prisma generate; runtime uses --ignore-scripts
docker-compose.yml     postgres:18-alpine on 127.0.0.1:5432 + `web` (proves the image)
.github/workflows/ci.yml  postgres service → npm ci → db:deploy → npm run check:all
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

## How auth works (Phase 2)

- `POST /auth/github` → remix-auth redirects to GitHub (`repo` scope, state in
  the `er_oauth` cookie). `GET /auth/github/callback` exchanges the code, the
  verify callback fetches `/user` and upserts `users` keyed on `github_id`,
  then the route mints a `sessions` row and sets two signed HttpOnly cookies:
  `er_session` (session id, 7 days) and `gh_access_token` (90 days). **The
  GitHub token is never written to the database.**
- Root middleware (`sessionMiddleware`) loads the session + user into route
  context on every request and rolls the session (row + cookie) once less than
  half its lifetime remains. It never redirects.
- Protected pages nest under `routes/_gated.tsx`, whose `allowlistGate`
  middleware requires a user whose login is in `allowed_users`; otherwise it
  deletes the session, clears both cookies and redirects to `/login` (no
  session) or `/denied` (not allowed). Public routes live outside the layout.
  Gated pages must export a loader so the chain runs.
- `POST /auth/logout` uses the same `signOutHeaders`. `/relink` (gated)
  re-runs the OAuth flow when the token cookie is missing/rejected.
- Repositories PB rules used to enforce (owner-only cancel, authed reads) are
  explicit checks in loaders/actions from Phase 3 on.

## How a review runs (Phase 3)

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

## Conventions

- Path alias `@/*` → `src/*` is used in `src/web/` (bundled by Vite).
  Everything Node may load natively — `server/`, `src/config`, `src/common`,
  `src/db`, `src/domain`, `src/jobs` — uses relative imports with explicit
  `.ts` extensions.
- Server-only modules use the React Router `*.server.ts` filename convention
  (A12, refined by phase-3-plan P3-D4): `db`/`config` by location, `domain`
  and `web` by filename.
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
- `legacy/` is reference only. Port from it; never import it.
- No barrel `index.ts` files. Import the module you need
  (`@/web/theme/theme`, not `@/web/theme`).

## Scripts

| Script                                     | What                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `npm run dev`                              | Express + Vite dev server on `localhost:3000`                        |
| `npm run build` / `npm start`              | `react-router build` / serve `build/` in production mode             |
| `npm run typecheck`                        | `react-router typegen && tsc --noEmit`                               |
| `npm test` / `test:watch`                  | Vitest `unit` + `web` + `guardrails`                                 |
| `npm run test:integration`                 | Vitest `integration` (needs Postgres; skips when unreachable)        |
| `npm run lint` / `format` / `format:check` | oxlint / Prettier                                                    |
| `npm run check`                            | **The gate**: typecheck + build + test + lint + format:check         |
| `npm run check:all`                        | `check` + integration                                                |
| `npm run db:migrate`                       | `prisma migrate dev && prisma generate` (local schema changes)       |
| `npm run db:deploy` / `db:reset`           | apply migrations (CI/containers) / drop + reapply + generate         |
| `npm run db:generate` / `db:studio`        | regenerate client (also `postinstall`) / Prisma Studio               |
| `npm run job -- <name> [args]`             | one-shot jobs, natively: `seed-allowlist <login...>`, `recover-jobs` |

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
