# Phase 3 — Review job lifecycle (stub worker)

## Goal

Build the entire job pipeline end-to-end with a **stub worker** that produces fake output. This proves the queue, worker container, Realtime subscription, cancellation, and history list all work — before we add the complexity of real cloning and real opencode in Phase 4.

## Demoable at end

- Clicking "Review" creates a `review_jobs` row and navigates to a `/jobs/:id` page.
- The page shows status updating live: `pending → running → done` (or `cancelled` / `error`).
- Fake "chunks" stream in via Supabase Realtime and render in a textbox as they arrive.
- A "Cancel" button on a running job sets status to `cancelled` and the worker stops emitting chunks.
- A history page lists jobs (yours + every beta member's) with status and target.
- Two browsers signed in as different beta users can both see the same review history (workspace visibility).

## Tasks

1. **Schema migration**:

   ```sql
   create table review_jobs (
     id            uuid primary key default gen_random_uuid(),
     user_id       uuid not null references auth.users(id),
     target        jsonb not null,                      -- ReviewTarget from Phase 2
     status        text not null default 'pending',     -- pending|running|done|error|cancelled
     head_sha      text not null,
     created_at    timestamptz not null default now(),
     started_at    timestamptz,
     completed_at  timestamptz,
     cancelled_at  timestamptz,
     error_message text,
     worker_id     text                                 -- claimed-by, for crash recovery
   );

   create table reviews (
     id            uuid primary key default gen_random_uuid(),
     job_id        uuid not null unique references review_jobs(id) on delete cascade,
     content       jsonb not null,                      -- final structured narrative (POC shape)
     created_at    timestamptz not null default now()
   );

   create table review_chunks (
     id        bigserial primary key,
     job_id    uuid not null references review_jobs(id) on delete cascade,
     seq       int  not null,
     content   text not null,
     created_at timestamptz not null default now(),
     unique (job_id, seq)
   );
   create index on review_chunks (job_id, seq);
   ```

2. **RLS policies**:
   - `review_jobs`: insert restricted to authenticated user setting `user_id = auth.uid()`. Select allowed for any authenticated user (workspace visibility). Update restricted to the worker (service role) and to the owner for cancellation.
   - `reviews` and `review_chunks`: select allowed for any authenticated user; insert/update restricted to service role.

3. **Realtime publication** — enable Realtime on `review_jobs` (status updates) and `review_chunks` (streaming).

4. **`POST /api/jobs`** — create a job. Body = `ReviewTarget`. Returns `{ id }`. Resolves `head_sha` server-side from GitHub at insert time.

5. **`POST /api/jobs/:id/cancel`** — sets status to `cancelled` and `cancelled_at = now()`. RLS allows only the owner to call this (or the operator).

6. **Worker container** — new service in `docker-compose.yml`:
   - Node + TypeScript image.
   - Connects to Postgres with the service role.
   - Listens on Postgres `LISTEN/NOTIFY` for new jobs (or polls every 1s as a fallback) — pick one and document.
   - Claims a `pending` job (`UPDATE ... SET status='running', started_at=now(), worker_id=$1 WHERE status='pending' RETURNING *` with `FOR UPDATE SKIP LOCKED`).
   - **Stub behavior**: emits 5 fake chunks ~1s apart, checking for cancellation between each, then writes a fake `reviews` row + sets `status='done'`.
   - Cancellation check: re-reads `status` between chunks; if `cancelled`, exits cleanly.

7. **Frontend `/jobs/:id` page** — subscribes to `review_jobs` row + `review_chunks` insertions via Realtime. Renders chunks in order. Shows status pill + cancel button.

8. **Frontend `/history` page** — lists all jobs (workspace visibility) with target, status, requested-by, timestamps.

9. **Crash recovery** (lightweight) — on worker boot, reset any `running` jobs claimed by this worker's `worker_id` back to `pending`. Document this is best-effort and not a full HA solution.

## Out of scope (deferred)

- Real cloning, real opencode, real diff/file filter (Phase 4).
- Multiple concurrent workers / queue priorities (Phase 7).
- Per-user concurrency caps (Phase 7).

## Open questions

- **`LISTEN/NOTIFY` vs polling** — `LISTEN/NOTIFY` is more responsive; polling is more robust. Pick during planning. Polling is fine for v1 given the manual trigger model.
- **Where does the worker get the GitHub token for `head_sha` resolution?** — in Phase 3 the API does the lookup at job-creation time, so the worker doesn't need a GitHub token yet. Phase 4 changes this.
- **Job → review uniqueness** — current schema has `reviews.job_id` unique. Re-runs create a new job, not a new review under the same job. Confirm this matches the intended UX.
