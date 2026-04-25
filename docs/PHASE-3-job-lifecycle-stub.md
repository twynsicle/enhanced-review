# Phase 3 — Review job lifecycle (stub worker)

## Goal

Build the entire job pipeline end-to-end with a **stub worker** that produces fake output. This proves the queue, worker container, Realtime subscription, cancellation, and history list all work — before we add the complexity of real cloning and real opencode in Phase 4.

## Demoable at end

- Clicking "Review" on the Phase 2 picker creates a `review_jobs` row and navigates to `/jobs/:id`.
- The page shows status updating live: `pending → running → done` (or `cancelled` / `error`).
- Fake "chunks" stream in via Supabase Realtime and render in a textbox as they arrive.
- A "Cancel" button on a `pending` or `running` job sets status to `cancelled` and the worker stops emitting chunks.
- A `/history` page lists jobs (yours + every beta member's) with target, status, requester, and timestamps; status filter chips work.
- Two browsers signed in as different beta users can both see the same review history (workspace visibility).

## Tasks

1. **`packages/review-types/`** — new workspace package, types-only (no runtime code). Ports the narrative type cluster from `diffy/src/shared/types.ts`: `NarrativeReview`, `NarrativeChapter`, `Insight`, `InsightType`, `DiffChunk`, `ResolvedDiffHunk`, `DiffLineSpan`, `SUMMARY_SECTION_ID`. Frontend (Phase 6 renderer) and worker (Phase 4 parser) both depend on it; Phase 3 uses it for the stub `reviews.content`.

2. **Schema migration** (`supabase/migrations/0002_review_jobs.sql`):

   ```sql
   create table review_jobs (
     id            uuid primary key default gen_random_uuid(),
     user_id       uuid not null references auth.users(id),
     github_login  text not null,                      -- denormalized from session.user.user_metadata.user_name
     target        jsonb not null,                     -- ReviewTarget (Phase 2)
     status        text not null default 'pending',    -- pending|running|done|error|cancelled
     head_sha      text not null,                      -- resolved server-side at insert time
     created_at    timestamptz not null default now(),
     started_at    timestamptz,
     completed_at  timestamptz,
     cancelled_at  timestamptz,
     error_message text,
     worker_id     text                                -- claim identity, UUID-per-boot (debug breadcrumb)
   );
   create index on review_jobs (status);               -- worker boot-recovery sweep
   create index on review_jobs (created_at desc);      -- /history sort
   create index on review_jobs (user_id);              -- per-user lookups in Phase 7

   create table reviews (
     id         uuid primary key default gen_random_uuid(),
     job_id     uuid not null unique references review_jobs(id) on delete cascade,
     content    jsonb not null,                        -- NarrativeReview shape
     created_at timestamptz not null default now()
   );

   create table review_chunks (
     id         bigserial primary key,
     job_id     uuid not null references review_jobs(id) on delete cascade,
     seq        int not null,
     content    text not null,
     created_at timestamptz not null default now(),
     unique (job_id, seq)
   );
   create index on review_chunks (job_id, seq);
   ```

3. **`AFTER INSERT` trigger** (same migration) — `pg_notify('review_jobs_pending', NEW.id::text)` fires on every insert into `review_jobs`. Source-agnostic: works no matter what creates the row. The worker `LISTEN`s on this channel.

4. **RLS policies**:
   - `review_jobs`:
     - Insert: `user_id = auth.uid()` (the API additionally enforces `github_login` matches the session).
     - Select: any authenticated user (workspace visibility).
     - Update: owner only, only when transitioning `pending|running → cancelled` and setting `cancelled_at`. Service role bypass for the worker's status writes.
   - `reviews`, `review_chunks`: select for any authenticated user; insert/update default-denied (service role bypasses).

5. **Realtime publication** (same migration) — `alter publication supabase_realtime add table review_jobs, review_chunks;`. Without this the `/jobs/:id` page polls forever.

6. **`POST /api/jobs`**:
   - Body = `ReviewTarget`, validated with Zod.
   - Reads session via `@supabase/ssr`. No session → 401.
   - Reads `provider_token` from the session. Missing → 401 `{ reason: 'github_token_invalid' }` (client redirects to `/relink`, same as Phase 2).
   - **Re-resolves `head_sha` server-side** from GitHub (PR target → `GET /repos/:owner/:repo/pulls/:number`; branch target → `GET /repos/:owner/:repo/branches/:ref`). Client-supplied `headSha` is ignored — picks up commits pushed between picker selection and clicking Review. GitHub 401 → same `github_token_invalid` shape.
   - Inserts via the **service-role client**, copying `user_id` and `github_login` from the verified session. Returns `{ id }`.
   - The trigger fires `pg_notify`; the worker picks the job up.

7. **`POST /api/jobs/:id/cancel`**:
   - Uses the user-scoped Supabase client (no service role) so RLS enforces "owner only".
   - Updates `status='cancelled'`, `cancelled_at=now()` if current status ∈ {pending, running}; otherwise 409.
   - Worker observes the change between chunk emissions and exits cleanly (chunks already written are kept; no `reviews` row).

8. **`packages/worker/`** — new workspace package, **dual-mode**:
   - **Dev**: `npm run dev` runs `tsx watch src/index.ts` against an already-running Supabase. Fast inner loop.
   - **Compose**: `Dockerfile` (Node 20 base) plus a new `worker` service in `docker-compose.yml`. Production-shaped, identical code path.
   - **Connections**:
     - `pg` (node-postgres) client to `DATABASE_URL` for `LISTEN review_jobs_pending` and the claim `UPDATE`. `supabase-js` doesn't expose `LISTEN/NOTIFY`.
     - `@supabase/supabase-js` with the service-role key for chunk inserts and the final `reviews` row.
   - **Boot sequence**:
     1. `WORKER_ID = crypto.randomUUID()`.
     2. **Crash-recovery sweep** (single-worker invariant): `UPDATE review_jobs SET status='pending', worker_id=null, started_at=null WHERE status='running'`. Documented as best-effort; Phase 7 replaces with heartbeat-based recovery once we run multiple workers.
     3. `LISTEN review_jobs_pending`.
     4. **Drain pass**: claim any rows already in `pending` (covers a NOTIFY missed during the restart window).
     5. Enter the main loop: on each NOTIFY (or after reconnect), attempt to claim and run.
   - **Claim** (single statement, FOR UPDATE SKIP LOCKED on the inner select):
     ```sql
     update review_jobs set status='running', started_at=now(), worker_id=$1
     where id = (
       select id from review_jobs where status='pending'
       order by created_at limit 1 for update skip locked
     )
     returning *;
     ```
   - **Stub run**: emit 5 fake chunks ~1s apart. Between chunks, re-`select status` for the job; if `cancelled`, exit cleanly. After all five, write a hard-coded `NarrativeReview` (chapters + insights + diff chunks with placeholder text) to `reviews.content`, set `status='done'`, `completed_at=now()`.
   - **Reconnect**: on `pg` connection error, exponential back-off; after reconnect, drain pass again.

9. **Frontend `/jobs/:id`** — server-component shell with a client component for live state.
   - Subscribes via Supabase Realtime to a per-job channel (`jobs:<id>`) with **server-side filters**: `id=eq.<id>` for `review_jobs` row updates, `job_id=eq.<id>` for `review_chunks` inserts.
   - Renders chunks ordered by `seq` in a preformatted textbox (auto-scrolled to bottom).
   - Status pill: `pending | running | done | cancelled | error`.
   - Cancel button visible when status ∈ {pending, running}; disabled while the request is in flight.
   - When `status='done'`, no review render — chunks textbox + pill is the entire UI for Phase 3. Phase 6 builds the rendered chapter UI at `/reviews/:id`.

10. **Frontend `/history`** — server component fetching the most recent 100 jobs (`order by created_at desc`).
    - Columns: target (`owner/repo PR #123 — title` for PR; `owner/repo branch:<ref>` for branch), status pill, requester (`@<github_login>`), created relative time, link to `/jobs/:id`.
    - Status filter chips above the table: `all | pending | running | done | cancelled | error`. Selection lives in a URL query param (`?status=running`) so it survives reload and is shareable.
    - Empty state: "No reviews yet — pick a repo to start one →" linking to `/picker`.

11. **Wire the Phase 2 "Review" button** — picker detail page handler now `POST /api/jobs` with the resolved `ReviewTarget`, then `router.push('/jobs/' + id)`. On 401 with `github_token_invalid`, redirect to `/relink`.

12. **Tests** (Vitest):
    - `packages/worker/` unit tests covering claim logic, the chunk-emit loop, mid-flight cancellation check, and reconnect drain. Use a stubbed `pg` client + fake supabase service-role client (no real DB).
    - **RLS smoke tests** in `supabase/tests/`: a user can insert and cancel their own job, cannot cancel another user's job, an unauthenticated request cannot select. Run via `psql` against a clean dev DB. Lightweight — Phase 7 fleshes out RLS coverage.
    - No frontend tests required.

## Decisions (resolved)

- **Worker placement**: new `packages/worker/`, dual-mode (`tsx watch` for dev, Dockerfile for compose).
- **Job pickup**: `LISTEN/NOTIFY` only via a Postgres `AFTER INSERT` trigger. No polling fallback. The worker drains pending rows on boot and after every reconnect to cover missed NOTIFYs. Polling is deferred to Phase 7 if we observe stuck jobs.
- **Job-create auth**: route handler verifies the session via `@supabase/ssr`, then inserts with the service-role client copying `user_id` and `github_login` from the verified session. Manual auth check on the API surface; service-role key isolated to server-only code.
- **Narrative type source**: ported from `diffy/src/shared/types.ts` (the `NarrativeReview` cluster) into `packages/review-types/`.
- **Cancel scope**: both `pending` and `running` jobs are cancellable.
- **`worker_id`**: UUID generated per worker boot. Debug breadcrumb only — crash recovery uses the simpler "reset everything in `running`" sweep under the single-worker invariant.
- **`/jobs/:id` done state**: chunks textbox + status pill, no review render. Phase 6 owns `/reviews/:id`.
- **Realtime channels**: one channel per job with server-side filters.
- **`/history`**: minimal table sorted by `created_at desc` with status filter chips. No search, no pagination.
- **Tests**: worker stub logic + RLS smoke. No frontend tests.
- **`github_login` denormalization**: stored on `review_jobs` directly. Avoids a public view over `auth.users` and keeps `/history` reads trivial.
- **`head_sha` resolution**: re-resolved server-side in `POST /api/jobs` (client value ignored), so a Review click always pins to the latest tip.

## Out of scope (deferred)

- Real cloning, real opencode, real diff/file filter (Phase 4).
- Token-by-token streaming from the executor (Phase 5).
- The rendered chapter UI for finished reviews — Phase 6 builds `/reviews/:id`.
- Multiple concurrent workers, queue priorities, per-user concurrency caps (Phase 7).
- Heartbeat-based crash recovery (Phase 7); v1 leans on the single-worker invariant.
- Polling fallback for `LISTEN/NOTIFY` (Phase 7 if needed).
- `review_chunks` retention / cleanup (Phase 5).
- Re-run UX (Phase 6).

## Open questions

- **`pg` library choice for the worker** — `pg` (node-postgres) is the obvious pick; `postgres.js` is leaner but its `LISTEN/NOTIFY` API is less battle-tested. Confirm during planning.
- **Stub `NarrativeReview` content** — placeholder chapters with realistic-looking but obviously-fake text? Lorem ipsum? Decide during planning so the demo looks coherent without setting Phase 6 expectations.

## Risks

- **`LISTEN/NOTIFY` only, no polling fallback.** A missed NOTIFY (worker reconnect, dropped connection, container restart racing with an insert) would leave a job stuck in `pending`. The drain pass on boot/reconnect mitigates but doesn't replace periodic polling. Acceptable for the closed beta with a manual trigger model; revisit if we see stuck jobs.
- **Service-role key in the Next.js process.** `POST /api/jobs` and `/api/jobs/:id/cancel` (the latter only via RLS-bypassing helpers if needed) put the key in the API runtime. Document the env var in `.env.example`. Never read the service-role key in any client component or `'use client'` file.
- **Crash recovery is single-worker-only.** If anyone runs two workers against the same DB during Phase 3 (e.g., dev `tsx watch` plus the compose service), they will fight over the boot sweep and one will reset the other's running jobs. Document the single-worker invariant; Phase 7 fixes properly.
- **RLS update policy is fiddly.** Owner-can-only-cancel-pending-or-running needs a `WITH CHECK` clause that's easy to get wrong. RLS smoke tests are required, not optional.
- **Realtime publication forgotten.** It's a one-line migration but easy to skip; without it, the page renders a permanent loading state and no one notices until the demo. Verify in the demo.
