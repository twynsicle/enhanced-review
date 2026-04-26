# Migration: Supabase → PocketBase

Plan for replacing the self-hosted Supabase stack and standalone worker with
PocketBase + an in-process job runner inside Next.js.

## Goal

Replace the 16-container vendored Supabase stack and the separate worker
container with:

- **One PocketBase binary** for auth, CRUD, and realtime.
- **Job execution folded into the Next.js process** — no separate worker.

Local-first: this plan optimises for "works on Windows with `npm run dev`",
not for AWS. AWS deployment is a future concern; the architecture chosen here
is AWS-friendly (PB on a Fargate task with EFS for `pb_data/`, Next.js on
another Fargate task) but no AWS-specific code is written in this migration.

## Why we're doing this

Captured for future readers — full discussion will be out of context by then.

- The vendored Supabase tree (`supabase/`) is ~thousands of files of compose,
  config, and Kong/Studio assets that we don't author and don't update.
- We are not at a scale (10–20 users total, ~5 concurrent jobs max) that
  justifies a queue, RLS, pgsodium, or a separate worker process.
- The `.env`-heavy secret model from Supabase is a poor fit for an
  agent-driven workflow where files in the working tree are easy to read.
- App is pre-launch with no users and no production data, so a big-bang
  rewrite is acceptable — no migration script needed.

## Decisions made (don't relitigate)

| Decision | Why |
| -------- | --- |
| PocketBase, not AWS-native (Cognito/RDS/S3) | Want admin UI + bundled auth+CRUD+realtime; Cognito DX is rough |
| Fold worker into Next.js, do not keep separate process | 5 concurrent jobs; eliminates one process and the API↔worker contract |
| Drop SQS / queue between API and worker | At this scale the API can just call the runner in-process; HMR-restart-during-job is acceptable in dev |
| Drop GitHub token encryption (`pgsodium`) entirely | Token is only needed in memory during a job; never persist it |
| Drop `pg_notify` / `LISTEN` worker pickup | No worker, no pickup |
| Use PB realtime SSE for live view | Direct replacement for Supabase `postgres_changes` |
| SQLite for `pb_data/`, not Postgres | Default PB story; adequate for this scale |
| No incremental cutover (no dual-running) | App is pre-launch; big-bang per phase is simpler |

## Target architecture

```
Browser ──POST /api/jobs──> Next.js API route
   │                            │
   │                            ├─ get GH token from PB session
   │                            ├─ pb.collection('review_jobs').create({ status: 'pending', ... })
   │                            ├─ kick off runJob(jobId, token, target) — fire and forget
   │                            └─ return { jobId }
   │
   └──pb.subscribe('review_chunks', ...)──> PocketBase
                                               ▲
   (in-process) runJob writes status updates ──┘
                and chunks to PB collections
```

Three local processes total: PocketBase, Next.js, and (optionally) a Vitest
watcher. No Docker required for the app itself.

## Phases

Each phase is a single PR / set of commits. Each ends at a verifiable state.
Tick the boxes inline as you finish each piece — this doc is the checklist.

### Phase 1 — PocketBase infrastructure

Goal: PB binary running locally with collections defined and GitHub OAuth
configured. App still broken; this phase touches no app code.

- [x] Add `tools/pocketbase/` (gitignored) and `scripts/pb-install.mjs`
      that downloads the matching PB release. Used `.mjs` instead of `.ps1`
      so the script works in PowerShell *and* Git Bash. Pinned to v0.37.3.
- [x] Add `npm run pb` and `npm run pb:install` scripts. PB starts at
      `http://127.0.0.1:8090` with `pb_data/` (gitignored) at the repo
      root. Launcher passes explicit `--dir` / `--migrationsDir` flags
      because PB resolves relative paths against the binary's directory,
      not CWD.
- [x] Define the four collections as `pb_migrations/1745539200_initial_schema.js`.
  - `allowed_users` — fields: `github_login` (text, unique). Rules: all empty
    (server-only via admin token).
  - `review_jobs` — fields: `user` (relation→users), `github_login`,
    `target` (json), `status` (select: pending|running|done|error|cancelled),
    `head_sha`, `started_at`, `completed_at`, `cancelled_at`, `error_message`.
    **No** `github_token_encrypted` field. Rules:
    - `listRule` / `viewRule`: `@request.auth.id != ""`
    - `createRule`: `null` (server-only)
    - `updateRule`: `@request.auth.id = user.id && (status = "pending" || status = "running")`
      (covers user-initiated cancel; server uses admin client for all
      other writes)
    - `deleteRule`: `null`
  - `reviews` — fields: `job` (relation→review_jobs), `content` (json),
    `diff_truncated` (bool). Rules: `viewRule`/`listRule` =
    `@request.auth.id != ""`; rest server-only.
  - `review_chunks` — fields: `job` (relation→review_jobs), `seq` (number),
    `content` (text). Indexes: unique on `(job, seq)`. Rules same as
    `reviews`.
- [x] Document GitHub OAuth registration and PB-side provider config in
      `docs/RUNNING-pocketbase.md`. Callback URL is
      `http://127.0.0.1:8090/api/oauth2-redirect`. Scopes: `repo`. The actual
      provider configuration is a manual step the operator does once via
      the PB admin UI — secrets stay in `pb_data/`, not in the repo.
- [x] Add `docs/RUNNING-pocketbase.md` (new parallel doc) and a banner at
      the top of `docs/RUNNING.md` pointing to it. Both docs valid in
      parallel until Phase 5 deletes the Supabase tree.

**Verifiable**: `npm run pb` starts PB; the four collections appear in the
admin UI with the correct fields, indexes, and rules. GitHub OAuth setup is
a manual operator step (see `RUNNING-pocketbase.md` §5) since secrets must
not be committed.

**Phase 1 surprises worth noting for later phases:**
- PB v0.37 does **not** auto-add `created` / `updated` system fields; you
  add them explicitly as `autodate` fields. Already done in the migration.
- PB resolves `--dir` / `--migrationsDir` relative to the **binary's**
  directory, not the process CWD. Always pass absolute paths.
- Tar from Git for Windows (GNU tar 1.35) cannot read zip files. Install
  script uses PowerShell `Expand-Archive` on Windows, `unzip` elsewhere.

### Phase 2 — Auth wiring in Next.js

Goal: log in via GitHub on the app, see authenticated session in server
components. CRUD reads still broken (next phase).

- [x] Add `pocketbase` SDK to `package.json` (`^0.26.2`). Supabase SDKs
      stay until Phase 4 / 5 — un-migrated CRUD call sites still import
      them.
- [x] Add `src/lib/pb/`:
  - `browser.ts` — `pbBrowser()` singleton. Mirrors `authStore` to a
    non-HttpOnly `pb_auth` cookie via `onChange()` so server reads see the
    same session. **Browser-only.**
  - `client.ts` — `pbServer()`. Per-request, hydrates from
    `cookies()` (Next 16 async API), writes back on refresh. Marked
    `'server-only'`. Split into a separate file from `pbBrowser` because
    `next/headers` can't be in a client bundle.
  - `admin.ts` — `pbAdmin()` (PB v0.23+ uses `_superusers` collection,
    not the old `pb.admins`). Module-scoped token cache; `withAdminRetry`
    wrapper re-auths once on 401.
  - `session.ts` — `getCurrentUser()` returns the typed PB record;
    `readGithubTokenCookie()` reads the HttpOnly token cookie.
  - `types.ts` — `UserRecord`, `PB_AUTH_COOKIE`, `GH_TOKEN_COOKIE`.
- [x] Replace `src/proxy.ts` (middleware) Supabase session handling with
      PB equivalent. Reads `pb_auth` cookie via `request.cookies` (not
      `next/headers` — middleware uses request-bound cookies), checks
      `pb.authStore.isValid`, runs allowlist via `pbAdmin()`, clears both
      cookies on denial.
- [x] Update `.env.local` and `.env.example`:
  - Added `NEXT_PUBLIC_POCKETBASE_URL`, `POCKETBASE_URL`,
    `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`. Operator must
    fill the admin creds locally — see `RUNNING-pocketbase.md` §3.
  - `NEXT_PUBLIC_SUPABASE_*` left in place (deprecated comment) — Phase 3
    code still reads them.
- [x] Add `pb_migrations/1777300000_users_github_login.js`: extends the
      `users` auth collection with `github_login` text + unique partial
      index. Populated by `/api/auth/post-signin` from
      `authWithOAuth2`'s `meta.username`.
- [x] Add `src/app/api/auth/post-signin/route.ts`: browser POSTs here
      after `authWithOAuth2` resolves. Sets the HttpOnly
      `gh_access_token` cookie and backfills `github_login` / `name` /
      `avatar_url` on the user record via `pbAdmin()`.
- [x] Add `src/app/api/auth/sign-out/route.ts`: clears both auth cookies
      server-side (the HttpOnly token can't be cleared from JS).
- [x] **Delete** `src/app/auth/callback/route.ts`. PB's `authWithOAuth2`
      does popup-based OAuth — the popup hits PB's
      `/api/oauth2-redirect` and notifies the parent via realtime — so
      the app no longer owns a callback URL.
- [x] Replace the auth call sites (turned out to be ~14, not 8 — every
      `getUser` / `signOut` / `signInWithOAuth` site, plus the `getSession`
      call in `lib/github/token.ts`). Data queries (`from(...).select`,
      RPCs, realtime subscriptions) deliberately left on Supabase — Phase 3
      moves them. They'll fail at runtime with a PB session, which is the
      expected Phase 2 state.
  - `src/app/login/sign-in-button.tsx`, `src/app/relink/relink-button.tsx`
    — `pb.collection('users').authWithOAuth2({ provider: 'github',
    scopes: ['repo'] })`, then POST `meta.accessToken` + `meta.username`
    to `/api/auth/post-signin`, then `window.location.href = '/'`.
  - `src/proxy.ts` — full rewrite (above).
  - `src/components/topbar/user-menu.tsx` — `pbBrowser().authStore.clear()`
    plus a fetch to `/api/auth/sign-out` (clears the HttpOnly token).
  - `src/app/{layout,page,login/page,history/page,jobs/[id]/page,reviews/[id]/page}.tsx`
    + `src/components/home/recent-reviews.tsx` —
    `await getCurrentUser()` returning a typed `UserRecord`.
  - `src/app/api/jobs/route.ts`, `.../[id]/cancel/route.ts`,
    `.../[id]/rerun/route.ts`, `src/app/api/github/file/route.ts` —
    `await getCurrentUser()` for auth, Supabase still for data.
  - `src/lib/github/token.ts` — reads the `gh_access_token` HttpOnly
    cookie via `readGithubTokenCookie()`. No more refresh attempts (PB
    doesn't expose a GitHub refresh token any more than Supabase did).
  - `src/lib/auth/allowlist.ts` — `getGithubLogin(user)` reads
    `user.github_login`; `isAllowed(pb, login)` uses
    `getFirstListItem("github_login = ...")` and treats 404 as "not
    allowed" / non-404 errors as fail-closed.
- [x] Tests updated: `allowlist.test.ts` (PB stub instead of Supabase
      stub), `api/github/file/route.test.ts` and
      `api/jobs/[id]/rerun/route.test.ts` (mock `getCurrentUser` instead
      of `supabase.auth.getUser`). 200 tests pass.

**Verifiable**: clicking "Sign in with GitHub" lands you back on the app
authenticated; refreshing the page keeps you signed in; the middleware
allowlist check works (denies non-allowlisted users); sign-out clears the
session. CRUD pages render but show no data (Phase 3 fixes).

**Phase 2 surprises worth noting for later phases:**
- PB `authWithOAuth2` does popup-based OAuth automatically — no app-side
  callback route needed. The PB-side callback URL
  `http://127.0.0.1:8090/api/oauth2-redirect` is internal to PB.
- `meta.accessToken` is returned once at OAuth time and not persisted by
  PB. We mirror it into an HttpOnly cookie set in `/api/auth/post-signin`.
  No DB persistence of the GitHub token, matching the migration intent.
- `meta.username` is the GitHub login. PB's auto-generated `username`
  field gets a random `users<hash>` slug; we added `github_login` as a
  separate field on the users collection rather than overload `username`.
- PB SDK's browser `LocalAuthStore` writes only to `localStorage` by
  default; SSR needs a cookie. `pbBrowser()` subscribes to
  `authStore.onChange` and mirrors via `document.cookie =
  pb.authStore.exportToCookie({ httpOnly: false, ... })`.
- PB v0.23+ uses `_superusers` collection (not `pb.admins`) for admin
  auth. `pb.collection('_superusers').authWithPassword(email, password)`.
- Splitting `pb/browser.ts` from `pb/client.ts` (server) is mandatory:
  importing `next/headers` in a module that gets bundled into a client
  component fails the build. The barrel `pb/index.ts` re-exports only
  server-safe bindings; client components import `pbBrowser` directly
  from `@/lib/pb/browser`.

### Phase 3 — CRUD reads + writes

Goal: pages render data from PB. Job creation works (but the runner is still
the old worker, which is broken since `pg_notify` is gone — so submitted jobs
sit in `pending` forever. Phase 4 fixes that.)

- [ ] Replace `.from('table').select(...)` sites with `pb.collection('table').getList(...)` /
      `getOne` / `getFullList` as appropriate:
  - `src/lib/auth/allowlist.ts:28`
  - `src/app/history/page.tsx:42–45`
  - `src/app/page.tsx`
  - `src/components/home/recent-reviews.tsx:18–21`
  - `src/lib/jobs/concurrency.ts:44–49`
  - `src/app/api/health/route.ts:64–79`
  - `src/app/jobs/[id]/page.tsx:27–29,35–38`
  - `src/app/reviews/[id]/page.tsx:58–60,72–74`
  - `src/app/api/jobs/[id]/rerun/route.ts:56–58`
- [ ] Replace job creation in `src/app/api/jobs/route.ts:135` and
      `src/app/api/jobs/[id]/rerun/route.ts:131`:
      drop the `create_review_job_with_token` RPC call; use `pbAdmin()`
      to insert directly into `review_jobs` with `status: 'pending'`.
- [ ] Replace cancel in `src/app/api/jobs/[id]/cancel/route.ts:39–44`:
      `pb.collection('review_jobs').update(id, { status: 'cancelled' })`
      under the user's PB client (not admin) so the collection rule enforces
      ownership.
- [ ] Update `src/app/api/health/route.ts` queue-depth query.

**Verifiable**: every page that previously showed data still shows it,
sourced from PB. Submitting a job creates a `review_jobs` row in PB but
the row stays at `pending` (no runner yet).

### Phase 4 — Fold the worker into Next.js

Goal: end-to-end review flow works. Submitting a job runs it, chunks stream
to the live view via PB realtime.

- [ ] Move `packages/worker/src/` logic into `src/lib/jobs/runner/`:
  - `src/lib/jobs/runner/run.ts` — top-level `runJob({ jobId, token, target, model })`
    function. Pure async function, no daemon loop, no `LISTEN`, no pg
    client.
  - Port the executor selection (`stub` vs `opencode`), chunk emission,
    error handling, cancellation flag. Cancellation: keep an in-process
    `Map<jobId, AbortController>` that the cancel route signals.
  - All DB writes via `pbAdmin()` (chunks insert, status updates).
- [ ] Wire it into `src/app/api/jobs/route.ts`:
  - After creating the `review_jobs` row, get the GitHub token from the
    user's session, call `runJob(...)` *without awaiting* (fire-and-forget).
  - Catch and log unhandled rejections — they would otherwise crash the
    Node process.
- [ ] Wire cancellation in `src/app/api/jobs/[id]/cancel/route.ts`: after
      updating the row, call into the runner's cancellation registry to
      abort the in-flight job.
- [ ] Replace the two realtime subscription sites:
  - `src/app/jobs/[id]/job-live-view.tsx:38–73` — subscribe to
    `review_jobs/${id}` for status and `review_chunks` filtered by
    `job = "${id}"` for streaming chunks. Verify PB realtime delivers
    inserts in `seq` order; if not, keep the existing client-side dedup +
    sort logic.
  - `src/components/notifications/job-notifications.tsx:33` — subscribe to
    `review_jobs` filtered by `user = "${userId}"`.

**Verifiable**: submit a review of a small public PR; chunks stream into the
live view in real time; the row reaches `status = 'done'`; the reviewed
output appears on `/reviews/[id]`. Cancel mid-stream and the job stops.

### Phase 5 — Cleanup

Goal: delete everything we no longer need. Repo loses a few thousand files.

- [ ] Delete `supabase/` (the entire vendored tree).
- [ ] Delete `docker-compose.worker.yml`.
- [ ] Delete `packages/worker/` (after confirming Phase 4 runner is feature-
      equivalent — diff the two execution paths first).
- [ ] Remove from `package.json`: `@supabase/ssr`, `@supabase/supabase-js`.
      Run `npm install` to clean lockfile.
- [ ] Remove from `packages/github-client` and elsewhere: any `pg`
      dependency, any reference to `DATABASE_URL`, `SERVICE_ROLE_KEY`,
      `SUPABASE_*`.
- [ ] Delete `scripts/db-migrate.sh` and any other Supabase-specific scripts.
- [ ] Rewrite `docs/RUNNING.md` to reflect the new local setup (PB binary,
      `npm run pb`, no Docker required for the app).
- [ ] Delete this migration doc — or move to `docs/archive/` as a record.

**Verifiable**: a fresh clone of the repo + `docs/RUNNING.md` gets a new
developer to a working app without ever installing Docker or touching
Supabase.

## Things to verify before writing code in each phase

These were flagged as "I don't actually know the current PB behavior"
during planning. Resolve via PB docs (use Context7) or a 5-minute spike
before designing the affected code:

| Item | Affects | When to resolve |
| ---- | ------- | --------------- |
| PB's exact OAuth flow with Next 16 — does the app call `/api/oauth2-redirect`, or does PB redirect back to a URL we control with a code? | Phase 1 (callback URL), Phase 2 (auth/callback route) | Before Phase 1 |
| PB's SSR cookie name + serialization format with Next 16's async `cookies()` | Phase 2 (`pbServer()` design) | Before Phase 2 |
| How PB exposes the upstream GitHub provider token (or whether we have to do the OAuth handshake ourselves) | Phase 2 (`token.ts` rewrite); changes the threat model if we end up storing it | Before Phase 2 |
| PB realtime SSE behavior on reconnect — does it send a snapshot or just live events? Does it preserve `seq` ordering? | Phase 4 (chunk dedup logic) | Before Phase 4 |
| PB's behavior under concurrent admin-client writes from multiple in-flight jobs (we'll have ~5 jobs writing chunks simultaneously) | Phase 4 (runner concurrency) | Before Phase 4 |

## Out of scope

Do not let the migration grow into these:

- **AWS deployment.** Architecture is AWS-friendly; actual deployment is a
  separate effort.
- **AWS Secrets Manager wiring.** Local dev still uses `.env.local`; agent
  read-access concerns are addressed via `.claude/settings.json` deny rules,
  not by re-architecting secret storage.
- **Adding non-GitHub OAuth providers.** Single provider only.
- **Postgres-backed PB.** SQLite is fine at this scale.
- **Per-user rate limiting / queue depth controls.** Re-evaluate if the user
  count grows.
- **Migrating any data.** There is none. If anyone has been testing locally
  and wants their `review_jobs` history preserved, that's their problem to
  export manually.
