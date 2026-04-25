# Phase 7 — Polish

## Goal

The product works end-to-end after Phase 6. Phase 7 makes it survive small operational gotchas and feel solid for a closed-beta release.

## Demoable at end

- A worker that crashes (kill -9) doesn't leave jobs stuck in `running` forever — they get reset and retried or marked errored.
- Concurrency is bounded: at most N concurrent jobs across the worker fleet, at most M per user.
- Per-job timeouts kick in (e.g., opencode hung for 10 minutes → error).
- Logs are structured and queryable (worker stdout JSON-formatted; key events tagged with `job_id`).
- A README covers full setup, ops, troubleshooting.

## Tasks

1. **Worker crash recovery (real)** — periodic sweeper marks jobs in `running` whose `worker_id` no longer corresponds to a live worker (heartbeat table or fixed timeout) as `error` with `error_message='worker crashed'`. Decide: retry or surface to user.

2. **Per-job timeout** — env-configurable (`REVIEW_TIMEOUT_MIN`, default 10). Worker enforces; on timeout, kills opencode and marks `error`.

3. **Concurrency caps**:
   - Global: worker container runs at most N jobs in parallel (default 1, env-configurable).
   - Per-user: at most M concurrent jobs per `user_id` (default 1). Enforce by `SELECT count(*) FROM review_jobs WHERE user_id=$1 AND status IN ('pending','running')` at job-creation time; reject with a clear error if over.

4. **Structured logging** — pino or similar in the worker; every log line includes `job_id`. API routes do the same. Document the log format.

5. **Metrics endpoint (optional)** — `/api/health` returning queue depth, oldest pending job age, recent error count. Useful for ops, even if there's no dashboard yet.

6. **Error UX pass** — every error path has a friendly message and a "what now" suggestion (re-link GitHub, retry, contact operator).

7. **Empty-state pass** — first-time user sees a welcoming "no reviews yet — pick a repo to get started" instead of a blank page.

8. **Toast / notification system** — for cross-page events (job done while you're on another page). Browser notification permission optional.

9. **Retention policy** — `review_chunks` deleted after 7 days (set in Phase 5); reviews kept forever; failed jobs older than 30 days deleted. Implement via `pg_cron`.

10. **Operator README** — full ops doc: how to add users to the allowlist, how to rotate the opencode-zen key, how to upgrade opencode, how to view a worker's logs, how to re-queue a stuck job.

11. **End-to-end smoke test** — Playwright (or just a documented manual checklist): sign in → pick repo → review a PR → cancel → re-run → see history.

## Out of scope (still — these are post-beta)

- HA workers / multiple replicas.
- Webhook auto-trigger (originally deferred from the design phase).
- Posting reviews back to the GitHub PR.
- Per-user opencode-zen keys.
- Public hosting / multi-tenant SaaS.
- Billing.

## Open questions

- **Auto-retry on worker crash** — yes by default? With a max retry count? Or always require a manual re-run? Lean toward: auto-retry once, then require manual.
- **What counts as a "stuck" job?** — heartbeat-based (worker stops updating a `last_heartbeat` column) vs absolute timeout. Heartbeat is more accurate, more code.
- **Notifications** — browser native vs in-app toast vs email. Probably in-app toast for v1; email is a later feature.
