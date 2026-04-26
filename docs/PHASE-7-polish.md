# Phase 7 — Polish

## Goal

The product works end-to-end after Phase 6. Phase 7 makes it survive small operational gotchas and feel solid for a closed-beta release.

## Demoable at end

- A worker that crashes (kill -9) doesn't leave jobs stuck in `running` forever — they get marked errored once their absolute timeout elapses and the user can re-run.
- Per-user concurrency is bounded: a user with a job already pending or running can't submit another until it finishes.
- Per-job timeouts kick in (e.g., opencode hung for 15 minutes → error).
- Logs are structured JSON (pino) in both worker and Next.js; key events tagged with `job_id`.
- A new top-level `README.md` and `docs/OPERATIONS.md` cover dev setup and ops.

## Tasks

1. **Worker crash recovery via timeout** — periodic sweeper (runs every minute inside the worker) marks any job in `running` whose `started_at` is older than `REVIEW_TIMEOUT_MIN` as `error` with `error_message='timeout: worker crashed or job exceeded REVIEW_TIMEOUT_MIN'`. **No auto-retry** — the user re-runs manually via the existing rerun route. Boot-time `resetRunning` stays so a clean worker restart immediately resets `running` rows.
   - One mechanism handles both "opencode hung" and "worker died." No `last_heartbeat` column needed.

2. **Per-job timeout** — env-configurable (`REVIEW_TIMEOUT_MIN`, default **15**). Worker enforces in-process (kills opencode subprocess on timeout, marks `error`). Same threshold powers the sweeper in Task 1.

3. **Per-user concurrency cap** — at most one pending-or-running job per `user_id`. Enforce in `POST /api/jobs` via `SELECT count(*) FROM review_jobs WHERE user_id=$1 AND status IN ('pending','running')`; reject with a friendly error message + the in-flight job's id (so the UI can link to it).
   - Env: `MAX_JOBS_PER_USER` default 1.
   - **No global cap, no in-process parallelism.** Worker session stays strictly serial — single worker container, one job at a time. Multi-worker / parallel execution is post-beta.

4. **Structured logging** — pino in the worker; pino imported directly in Next.js API routes. Every worker log line includes `job_id` (via `pino.child({ job_id })`); API route logs include `job_id` when handling a job-scoped request. Document the JSON shape in `docs/OPERATIONS.md`.

5. **Health endpoint** — `GET /api/health`, **public, no secrets**. Returns `{ queueDepth, oldestPendingAgeSec, errorsLast24h }`. Useful for ad-hoc ops checks even without a dashboard.

6. **Error UX pass** — every error path gets a friendly message + a "what now" suggestion. Surfaces in scope:
   - **Picker** (repos / pulls / branches): GitHub auth, rate-limit, network — show "Re-link GitHub" or "Retry" actions.
   - **Job creation** (`POST /api/jobs`): per-user concurrency rejection ("you already have a review running — view it"), head_sha fetch fail, missing token.
   - **Job detail / running page**: worker-crash error, opencode error, timeout, cancellation — each with a "what now" line.
   - **Auth / denied page**: not-on-allowlist, OAuth failure — clear next step (contact operator).

7. **Empty-state pass** — friendly empty content on:
   - Home / history (no reviews yet).
   - Picker when zero repos returned.
   - Picker when selected repo has zero open PRs / non-default branches.
   - Job detail before the first chunk arrives ("Setting up your review…").

8. **Toast / notification system** — shadcn **Radix Toast** component (`npx shadcn@latest add toast`). Mount a `<Toaster />` at the app root and subscribe to `review_jobs` realtime app-wide (filtered to the signed-in user). When a user's job transitions to `done` / `error` / `cancelled` while they're on another page, fire a toast linking to it. Additionally: if `Notification.permission === 'granted'` and the tab is hidden (`document.visibilityState === 'hidden'`), fire a browser notification too. Permission is opt-in via a "Enable browser notifications" button in the user menu.

9. **Retention policy — deferred to post-beta.** Document the intended cleanup SQL (`review_chunks` > 7d, failed `review_jobs` > 30d, `reviews` kept) in `docs/OPERATIONS.md` but don't schedule it. `pg_cron` not currently installed.

10. **Ops documentation** — two new files:
    - `README.md` (new, root): project intro, stack, local dev setup (docker-compose, `pnpm dev`, worker), pointer to `docs/`.
    - `docs/OPERATIONS.md` (new): adding users to the allowlist, rotating the opencode-zen key, viewing a worker's logs, re-queueing a stuck job (manual SQL), pino log shape reference.
    - `docs/README.md` stays as the plan-of-record (no edits beyond a link to OPERATIONS).

11. **End-to-end smoke test — deferred to post-beta.** No Playwright suite for v1.

## Out of scope (still — these are post-beta)

- HA workers / multiple replicas.
- In-process parallelism (`MAX_JOBS_PER_WORKER > 1`).
- Auto-retry on worker crash.
- Heartbeat-based crash detection.
- Webhook auto-trigger.
- Posting reviews back to the GitHub PR.
- Per-user opencode-zen keys.
- Public hosting / multi-tenant SaaS.
- Billing.
- pg_cron / scheduled retention.
- Playwright e2e suite.
