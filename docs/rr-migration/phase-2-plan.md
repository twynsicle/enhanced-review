# Phase 2 — Data + auth

**Goal:** stand the app's persistence and sign-in path up on the new stack.
At the end, a maintainer can `docker compose up -d postgres`, run the
migration, seed themselves into the allowlist, sign in with GitHub through the
server-side redirect flow, be gated by the allowlist, and sign out — all
against local Postgres, with `npm run check` green and integration tests that
skip cleanly when Postgres is down. No review/job UI is ported yet (Phase 4);
the index route stays the Phase 1 skeleton behind the gate.

Parent: [00-overview.md](./00-overview.md) — D3, D9, D10, D11, D12; A4, A5,
A6, A7, A8, A12, A13.

Builds on: [phase-1-plan.md](./phase-1-plan.md) (P1-D2 `.env`, P1-D5 native
TS on the server, P1-D6 alias, layering guardrails).

---

## Phase-level decisions

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-D1  | **User identity keys on the GitHub numeric id.** `users.github_id` is the stable unique key; `github_login`, `name` and `avatar_url` are refreshed from GitHub on every sign-in (A6). The allowlist still keys on `github_login` because that is what operators know. A login rename keeps the same user row and history but requires the operator to update the allowlist entry.                                                                                                                                                                                             |
| P2-D2  | **Schema is idiomatic Postgres/Prisma, not a PocketBase mirror.** UUID v7 primary keys (`@default(uuid(7))`, time-ordered), camelCase Prisma fields mapped to snake_case columns (`@map`/`@@map`), `review_chunks` uses the composite primary key `(job_id, seq)` instead of a surrogate id, `review_jobs.github_login` is dropped (join `users`), `status` is a Postgres enum, and `CHECK` constraints for `seq >= 0` and `risk_score BETWEEN 1 AND 5` are hand-added to `0001_init`. `seq = 0` is valid — the PocketBase `min: 0` bug found in Phase 0 does not carry over. |
| P2-D3  | **Sessions are DB rows (D3) via React Router's `createSessionStorage`.** The cookie (`er_session`, HttpOnly, SameSite=Lax, signed with `SESSION_SECRET`, 7-day `maxAge`) carries only the session id. Session data is `{ userId }`. Rolling (A6): the root middleware re-commits the session when less than half of its lifetime remains, refreshing both the row's `expires_at` and the cookie. Expired rows are ignored on read and purged on every successful sign-in.                                                                                                     |
| P2-D4  | **GitHub token lives only in the `gh_access_token` cookie (D3).** Set by the OAuth callback, HttpOnly, SameSite=Lax, 90-day `maxAge` (as today), `Secure` when `APP_ORIGIN` is https, and **signed** with `SESSION_SECRET` via `createCookie` so a tampered value is rejected instead of forwarded to GitHub. Never written to the database, never logged. Cleared on logout and on allowlist denial.                                                                                                                                                                         |
| P2-D5  | **Two middlewares, not one path list.** `root.tsx` exports a session middleware that loads the session + user into route context for every request (never redirects). A pathless layout route (`routes/_gated.tsx`) exports the allowlist gate; every protected page nests under it. Public routes (`/login`, `/denied`, `/auth/*`, `/api/health`) sit outside the layout, so "is this route public" is answered by the route tree instead of a `startsWith` list. Gated pages always export a loader so the middleware chain runs for document and data requests alike.      |
| P2-D6  | **remix-auth lives in `src/web/auth/`, GitHub-facing logic in `src/domain/auth/`.** `createSessionStorage`/`createCookie` come from `react-router`, which the layering guardrail keeps inside `src/web`. The strategy's verify callback calls `domain/auth` to fetch the GitHub profile (Zod-parsed) and upsert the user. `domain/auth/allowlist.ts` is the single allowlist rule. All of these are `*.server.ts`.                                                                                                                                                            |
| P2-D7  | **Prisma client is generated into `src/db/generated/` (gitignored) by `postinstall`.** Vite bundles it into `build/server`, so the runtime image needs only `@prisma/client`, `@prisma/adapter-pg` and `pg` and never runs `prisma generate` (`npm ci --omit=dev --ignore-scripts` in the runtime stage). No engine binaries: Prisma 7 with a driver adapter is engine-free. Only `src/db/**` may import the generated client or `@prisma/client` (new guardrail).                                                                                                            |
| P2-D8  | **`server/index.ts` never loads Prisma natively.** The db client is only reached through Vite (web server build now, jobs bundle in Phase 5). The db module owns its lifecycle and disconnects on SIGTERM/SIGINT itself. This sidesteps whether the generated client is Node-type-strippable. Commit 1 records the answer anyway: if it is erasable, `src/jobs/` can run natively and Phase 5's second Vite config becomes unnecessary.                                                                                                                                       |
| P2-D9  | **Required env keys with test defaults.** `DATABASE_URL`, `SESSION_SECRET` (min 32 chars), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_ORIGIN` are required in `env.ts`. `vitest.config.ts` loads `.env` when present and fills placeholders for whatever is missing, so `npm run check` runs on a machine with no `.env` at all. The integration project reads the real `DATABASE_URL`, probes it once in `beforeAll`, and skips the whole project when unreachable (A13).                                                                                              |
| P2-D10 | **Repositories for the tables this phase uses only.** `src/db/{users,sessions,allowed-users}.ts`. The `review_jobs` / `reviews` / `review_chunks` tables are created now (one `0001_init`) but their repositories land in Phase 3 next to their first callers, so no dead code ships.                                                                                                                                                                                                                                                                                         |
| P2-D11 | **`seed-allowlist` is a one-shot under `src/jobs/`, run via `npm run job -- seed-allowlist <login...>`.** Idempotent upsert. How it executes depends on the P2-D8 finding: natively when the generated client is erasable; otherwise through a small Vite `ssrLoadModule` runner in `server/job.ts` until Phase 5 ships the bundle. Either way the maintainer can seed themselves in this phase.                                                                                                                                                                              |
| P2-D12 | **CI gets a Postgres service and runs `check:all`.** `npm run check` stays Docker-free locally; CI is where integration tests are guaranteed to run instead of skipping.                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Target state after Phase 2

```
.
├── prisma/
│   ├── schema.prisma               6 models + JobStatus enum, provider only (url lives in prisma.config.ts)
│   └── migrations/
│       ├── migration_lock.toml
│       └── 0001_init/migration.sql  generated, then hand-edited: CHECK constraints
├── prisma.config.ts                defineConfig: schema, migrations path, datasource url from env
├── server/
│   ├── index.ts                    unchanged apart from a comment
│   └── job.ts                      (only if P2-D8 finds the client non-erasable) Vite runner for src/jobs
├── src/
│   ├── config/env.ts               + DATABASE_URL, SESSION_SECRET, GITHUB_CLIENT_ID/SECRET, APP_ORIGIN
│   ├── db/
│   │   ├── client.ts               PrismaClient + PrismaPg singleton, disconnect on signal
│   │   ├── users.ts                findById, upsertFromGithub
│   │   ├── sessions.ts             create, read (unexpired), touch, delete, deleteExpired
│   │   ├── allowed-users.ts        isAllowed, upsertMany
│   │   ├── *.integration.test.ts   real Postgres, self-skipping
│   │   └── generated/              (gitignored) prisma-client output
│   ├── domain/auth/
│   │   ├── github-profile.ts       fetch /user with token, Zod schema, GithubProfile type
│   │   ├── sign-in.ts              profile → users.upsertFromGithub → SessionUser
│   │   ├── allowlist.ts            isAllowed(login) — fail closed, logs on error
│   │   └── *.test.ts               fetch mocked
│   ├── jobs/
│   │   ├── cli.ts                  name → handler dispatch, exit codes
│   │   └── seed-allowlist.ts       args → allowedUsers.upsertMany
│   ├── guardrails/
│   │   └── prisma-access.guard.test.ts   new: generated client only from src/db
│   ├── test/integration-setup.ts   Postgres probe → skip project
│   └── web/
│       ├── root.tsx                + middleware: [sessionMiddleware]
│       ├── routes.ts               layout + public routes (table below)
│       ├── auth/
│       │   ├── context.ts          userContext (createContext)
│       │   ├── cookies.server.ts   session / github-token / oauth-state cookie config
│       │   ├── session.server.ts   createSessionStorage over db/sessions + shouldRoll()
│       │   ├── authenticator.server.ts  remix-auth Authenticator + GitHubStrategy
│       │   ├── session-middleware.server.ts
│       │   ├── gate-middleware.server.ts
│       │   └── *.test.ts
│       ├── components/brand-mark.tsx
│       └── routes/
│           ├── _gated.tsx          pathless layout: middleware [allowlistGate], <Outlet/>
│           ├── skeleton.tsx        gains a loader (user) so the gate runs; Phase 4 replaces it
│           ├── login.tsx           redirects authed+allowed → /; shows ?error banner
│           ├── denied.tsx
│           ├── relink.tsx          gated; POST /auth/github again
│           ├── auth.github.ts      action: authenticator.authenticate → redirect to GitHub
│           ├── auth.github.callback.ts  loader: authenticate → sign-in → session + token cookie → /
│           ├── auth.logout.ts      action: destroy session, clear token cookie → /login
│           └── health.ts           + db: 'ok' | 'error'
├── docker-compose.yml              unchanged
├── Dockerfile                      build stage: prisma generate; runtime: --ignore-scripts
└── .github/workflows/ci.yml        + postgres service, db:deploy, check:all
```

### Dependencies

Runtime: `@prisma/client@7.10`, `@prisma/adapter-pg@7.10`, `pg`, `remix-auth@4`,
`remix-auth-github@3` (brings `arctic` for the OAuth exchange).

Dev: `prisma@7.10`, `@types/pg`.

Versions: Prisma 8 is still RC (A8); `npm view prisma@7 version` resolves to
7.10.0 today. remix-auth 4.2.0 / remix-auth-github 3.0.2 are the current
majors named in D3.

### `package.json` scripts

| Script                | What                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `postinstall`         | `prisma generate` (P2-D7)                                             |
| `db:generate`         | `prisma generate`                                                     |
| `db:migrate`          | `prisma migrate dev && prisma generate` (7 no longer chains generate) |
| `db:deploy`           | `prisma migrate deploy` — CI and containers                           |
| `db:reset`            | `prisma migrate reset --force && prisma generate`                     |
| `db:studio`           | `prisma studio`                                                       |
| `job`                 | runs `src/jobs/cli.ts` (P2-D11)                                       |
| `test:integration`    | unchanged; now needs `DATABASE_URL` reachable to do anything          |
| `check` / `check:all` | unchanged                                                             |

### Prisma schema (`prisma/schema.prisma`)

```
generator client  { provider = "prisma-client", output = "../src/db/generated",
                    runtime = "nodejs", moduleFormat = "esm",
                    generatedFileExtension = "ts", importFileExtension = "ts" }
datasource db     { provider = "postgresql" }

enum JobStatus { pending running done error cancelled }

User          id uuid(7) · githubId BigInt @unique · githubLogin varchar(100) @unique
              · name? · avatarUrl? · createdAt · updatedAt · sessions[] · jobs[]
Session       id uuid(7) · userId? → User (cascade) · data Json · expiresAt · createdAt · updatedAt
              @@index([userId]) @@index([expiresAt])
AllowedUser   id uuid(7) · githubLogin varchar(100) @unique · createdAt
ReviewJob     id uuid(7) · userId → User (cascade) · target Json · status JobStatus
              · headSha varchar(64)? · startedAt? · completedAt? · cancelledAt?
              · errorMessage text? · riskScore smallint? · createdAt · updatedAt
              · review? · chunks[]   @@index([status]) @@index([userId]) @@index([createdAt])
Review        id uuid(7) · jobId @unique → ReviewJob (cascade) · content Json
              · diffTruncated Boolean @default(false) · createdAt
ReviewChunk   jobId → ReviewJob (cascade) · seq Int · content text · createdAt   @@id([jobId, seq])
```

All tables `@@map` to snake_case plural names (`users`, `sessions`,
`allowed_users`, `review_jobs`, `reviews`, `review_chunks`); all fields `@map`
to snake_case. `0001_init/migration.sql` is generated with
`prisma migrate dev --create-only`, then two `ALTER TABLE … ADD CONSTRAINT … CHECK`
lines are added before applying (P2-D2).

### `src/config/env.ts` additions

| Key                    | Rule                 | Notes                                                                                         |
| ---------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | `z.url()`            | `postgresql://enhanced_review:enhanced_review@127.0.0.1:5432/enhanced_review` matches compose |
| `SESSION_SECRET`       | `z.string().min(32)` | signs `er_session` and `gh_access_token`; rotating it signs everyone out                      |
| `GITHUB_CLIENT_ID`     | `z.string().min(1)`  | OAuth App (not GitHub App)                                                                    |
| `GITHUB_CLIENT_SECRET` | `z.string().min(1)`  |                                                                                               |
| `APP_ORIGIN`           | `z.url()`            | builds `redirectURI`; `https:` turns on `Secure` cookies                                      |

### Auth flow

1. `/login` renders a `<Form method="post" action="/auth/github">` button (no
   client JS needed). `?error=oauth` shows an alert.
2. `POST /auth/github` → `authenticator.authenticate('github', request)` →
   remix-auth-github stores PKCE/state in the `er_oauth` cookie (path `/auth`)
   and throws a redirect to GitHub with `scopes: ['repo']`.
3. `GET /auth/github/callback` → `authenticate` again → verify callback:
   `fetchGithubProfile(tokens.accessToken())` → `signIn(profile)` (upsert by
   `githubId`, refresh login/name/avatar) → returns `{ user, accessToken }`.
   Route creates a session (`{ userId }`), purges expired sessions, and
   responds with two `Set-Cookie`s (`er_session`, `gh_access_token`) and a
   redirect to `/`. Any non-redirect error → log at warn, redirect
   `/login?error=oauth`.
4. Every request: session middleware reads `er_session`, loads the row
   (unexpired) and the user, sets `userContext`; after `next()`, if
   `shouldRoll(expiresAt)` it re-commits and appends `Set-Cookie`.
5. Gated layout middleware: no user → destroy session, clear cookies,
   redirect `/login`; user not in `allowed_users` → same but `/denied`
   (warn log with login + id, as today).
6. `/login` loader: authed **and** allowed → redirect `/` (today's rule;
   authed-but-denied users may keep looking at the login page).
7. `POST /auth/logout` → destroy session row + both cookies → `/login`.
   GET is a 405.

Not carried over: the browser-side popup, `POST /api/auth/post-signin`,
`POST /api/auth/sign-out`, PocketBase avatar file download (avatar is the
GitHub URL, A6).

### Health

`GET /api/health` adds `db: 'ok' | 'error'` (a `SELECT 1` with a 2 s timeout).
Still always 200; `ok` stays "process is up". Queue fields still `null` until
Phase 3.

### Tests

| Project     | New tests                                                                                                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit        | `env.test.ts` (new required keys, url/min rules); `domain/auth/github-profile.test.ts` (fetch mocked: 200, non-200, bad shape); `web/auth/session.server.test.ts` (`shouldRoll` boundaries); `web/auth/gate-middleware.server.test.ts` and `session-middleware…test.ts` with in-memory fakes of the two repositories |
| web         | `login.test.tsx` (button posts to `/auth/github`, error banner), `denied.test.tsx`, `relink.test.tsx`                                                                                                                                                                                                                |
| guardrails  | `prisma-access.guard.test.ts`; layering `ALLOWED` unchanged; `server-only` guard covers the new `*.server.ts`                                                                                                                                                                                                        |
| integration | `db/users`, `db/sessions` (expiry, purge), `db/allowed-users` (exact match, idempotent seed), `web/auth/session.server.integration.test.ts` (create → read → roll → destroy round trip through `createSessionStorage`)                                                                                               |

### Docs touched in this phase

- `.env.example` — five new keys with comments.
- `docs/RUNNING.md` — interim "Phase 2 local setup" section: compose, migrate,
  OAuth app callback URL, seed. Full rewrite still Phase 6.
- `AGENTS.md` — repo layout (`prisma/`, `src/db`, `src/domain/auth`,
  `src/jobs`, `src/web/auth`), scripts, env, auth data flow, P2-D7/P2-D8
  conventions.
- `docs/rr-migration/00-overview.md` — A9 marked superseded by oxlint (missed
  in Phase 1), Phase 2 row status.

---

## Commit series

| #   | Commit                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Prisma foundation.** deps, `prisma.config.ts`, `schema.prisma`, `0001_init` (+CHECKs), `src/db/client.ts`, `db:*` + `postinstall` scripts, `.gitignore` `src/db/generated/`, `DATABASE_URL` in env + `.env.example`, vitest env defaults + integration probe, Dockerfile changes, `prisma-access` guardrail. Record the P2-D8 erasability finding in this doc's Deviations section. |
| 2   | **Repositories + domain/auth.** `users`, `sessions`, `allowed-users` repos with integration tests; `domain/auth/{github-profile,sign-in,allowlist}` with unit tests.                                                                                                                                                                                                                  |
| 3   | **Sign-in, sessions, gate, pages.** remix-auth deps, `src/web/auth/*`, auth routes, middlewares, `_gated.tsx`, login/denied/relink + BrandMark, health `db`, remaining env keys, tests.                                                                                                                                                                                               |
| 4   | **seed-allowlist + CI + docs.** `src/jobs/{cli,seed-allowlist}.ts`, `job` script (+ `server/job.ts` if needed), CI Postgres service + `check:all`, RUNNING interim section, AGENTS.md, overview touch-ups.                                                                                                                                                                            |

Each commit leaves `npm run check` green.

---

## Verification

1. `docker compose up -d postgres` → `npm run db:migrate` (creates
   `0001_init`) → `npm run db:reset` round-trips cleanly.
2. `npm run check` green with and without a `.env` present.
3. `npm run test:integration` runs (not skips) against compose Postgres; stop
   the container → every integration file reports skipped, exit code 0.
4. `npm run job -- seed-allowlist <maintainer-login>` inserts one row; running
   it again is a no-op.
5. Browser: `/` → 302 `/login`; sign in with GitHub → lands on `/`
   (skeleton) with `er_session` + `gh_access_token` cookies, both HttpOnly;
   `users` has one row with `github_id`; `sessions` one row.
6. Remove the allowlist row → next navigation → `/denied`, cookies cleared,
   session row deleted. Re-add → sign in again works.
7. Set the session row's `expires_at` to 3 days out → next request rolls it
   back to 7 days and re-sets the cookie.
8. `POST /auth/logout` (via devtools fetch; the user menu arrives in Phase 4)
   → cookies gone, row gone, `/login`.
9. `/api/health` reports `db: 'ok'`; stop Postgres → `db: 'error'`, still 200.
10. Screenshots of `/login`, `/denied`, `/relink` in both schemes into
    `screenshots/phase-2/`, compared against
    `screenshots/baseline/{login,denied,relink}--*`.
11. `docker build` succeeds with the runtime stage using `--ignore-scripts`
    and no `prisma` binary; the container serves `/api/health` with
    `db: 'error'` when pointed at nothing (proves the bundle carries the client).

## Exit criteria (from the overview, made concrete)

- Sign in, get gated, sign out, all against local Postgres (verification 5–8).
- Integration tests for repositories + allowlist skip cleanly when PG is down
  (verification 3).
- `npm run check` green; CI runs `check:all` with a Postgres service.
- No GitHub token anywhere in Postgres (inspect `sessions.data` after a
  sign-in: only `userId`).

## Maintainer actions

Before commit 3 can be verified:

1. In the existing GitHub OAuth App, change the **Authorization callback URL**
   from PocketBase's `http://127.0.0.1:8090/api/oauth2-redirect` to
   `http://localhost:3000/auth/github/callback`. Copy the client id and secret
   (visible in the PB admin UI under Settings → Auth providers, or regenerate
   the secret) into `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
2. Add to `.env`: `DATABASE_URL` (compose default above),
   `APP_ORIGIN=http://localhost:3000`, and `SESSION_SECRET` — generate one with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. `docker compose up -d postgres`.

The agent runs migrate and seed as part of verification once these exist.

## Deviations recorded during execution

- **Generated client is Node-erasable (P2-D8 finding).** `node --input-type=module -e "import('./src/db/generated/client.ts')"`
  loads under Node 24's type stripping with no flags. `src/jobs/` therefore
  runs natively (`node src/jobs/cli.ts …`); Phase 5 does not need a second
  Vite config or `server/job.ts`. P2-D8's rule that `server/index.ts` does
  not import Prisma stands, for lifecycle reasons rather than necessity.
- **Integration skip is a `globalSetup` + `inject`, not a `beforeAll`.** A
  `beforeAll` cannot skip a whole file, so `src/test/integration-global-setup.ts`
  probes Postgres once with `pg` and `provide`s `dbAvailable`; test files use
  `describeDb` from `src/test/db.ts` (`describe` or `describe.skip`). The
  integration project runs files serially (`fileParallelism: false`) because
  they share one database and truncate it. `src/test/integration-setup.ts`
  is deleted.
- **Test env defaults are set in `vitest.config.ts` via `process.env[key] ??=`**,
  not `test.env`, so the global setup (main process) and workers see the same
  values. `LOG_LEVEL` gains `silent` (pino supports it) and defaults to it in
  tests.
- **Guardrail glob bug fixed.** Phase 1's `matchesGlob` rewrote `**` to `.*`
  and then rewrote that `*` to `[^/]*`, so every trailing `/**` exclusion
  (including `src/guardrails/**`) silently never matched. Single-pass replace
  now; `src/db/generated/**` is added to the always-excluded set.
- **Dockerfile:** the deps stage also needs `--ignore-scripts` because
  `postinstall` runs `prisma generate` before the schema is copied; the build
  stage runs `npx prisma generate` explicitly.
- **Migration folder is renamed to `0001_init`** after `--create-only`
  (Prisma orders folders lexically; the name is free-form).
- **`.env` additions done by the agent:** `DATABASE_URL`, `APP_ORIGIN` and a
  generated `SESSION_SECRET` were appended to the maintainer's `.env` during
  commit 1 (non-secret defaults plus a fresh random secret). Only the GitHub
  client id/secret remain a maintainer action.
