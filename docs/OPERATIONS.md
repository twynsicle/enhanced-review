# Operations

Day-to-day runbook for the closed-beta deployment. The plan-of-record lives in [docs/README.md](README.md); this file is for "the thing's running, now what."

## Quick reference

| Want to…                            | See                                                    |
| ----------------------------------- | ------------------------------------------------------ |
| Add or remove a beta user           | [Allowlist management](#allowlist-management)          |
| Rotate the opencode-zen API key     | [Rotating the opencode-zen key](#rotating-the-opencode-zen-key) |
| Tail worker / API logs              | [Viewing logs](#viewing-logs)                          |
| Re-queue a stuck job                | [Re-queueing a stuck job](#re-queueing-a-stuck-job)    |
| Check queue health                  | [Health endpoint](#health-endpoint)                    |
| Adjust per-job timeout / concurrency| [Tunable knobs](#tunable-knobs)                        |
| Clean up old chunks / errored jobs  | [Retention (deferred)](#retention-deferred)            |
| Inspect the pino log shape          | [Log shape](#log-shape)                                |

---

## Allowlist management

Beta access is gated by `public.allowed_users.github_login`. RLS hides this table from authenticated users; only the service role can read or write it.

```sql
-- Add a user.
insert into public.allowed_users (github_login) values ('octocat')
on conflict (github_login) do nothing;

-- Remove a user (any active session of theirs is rejected on the next request).
delete from public.allowed_users where github_login = 'octocat';

-- List current allowlist.
select github_login, created_at from public.allowed_users order by created_at desc;
```

Apply via Studio's SQL editor (`http://localhost:8000`, dashboard creds in `supabase/.env`) or `psql` with the postgres password.

After removing a user, their existing reviews remain — RLS allows every beta member to see every other member's reviews (closed-beta workspace model). If you want their reviews gone, see [Re-queueing a stuck job](#re-queueing-a-stuck-job) for the row-level delete patterns.

## Rotating the opencode-zen key

The key is read from the worker's environment as `OPENCODE_ZEN_API_KEY` and never stored in the database. To rotate:

1. Generate a new key in the opencode-zen dashboard.
2. Update the value wherever the worker reads its env (`packages/worker/.env` for local dev, your container orchestrator's secret store in deployment).
3. Restart the worker process. There is exactly one — `docker compose -f docker-compose.worker.yml restart` (or your equivalent).
4. Revoke the old key.

Currently-running jobs can't pick up a new key mid-flight. They either finish on the old key (if the rotation happened after `opencode` started) or fail with an executor error (if it happened mid-stream); either way they end as `done` or `error` and the user can re-run.

## Viewing logs

Worker and API both emit single-line JSON via [pino](https://getpino.io). Every job-scoped line carries `job_id`; worker session lines also carry `worker_id`.

```bash
# Tail the worker container.
docker logs -f enhanced-review-worker

# Filter to a single job.
docker logs enhanced-review-worker 2>&1 | grep '"job_id":"<JOB-UUID>"'

# Pretty-print for human reading (jq is optional but recommended).
docker logs enhanced-review-worker 2>&1 | jq -c .

# Local dev: set LOG_PRETTY=1 in packages/worker/.env or .env.local for the
# Next.js side to swap in pino-pretty (colourised, human-friendly).
```

API logs go to the Next.js server's stdout. In production behind a reverse proxy / orchestrator, capture them the same way you capture any other Next.js stdout.

## Re-queueing a stuck job

The worker has three layers of stuck-job protection:

1. **Boot-time crash recovery** — when the worker process restarts, every row still in `running` is marked `status='error'` with `error_message='worker crashed before the review finished'`. The user can re-run from the UI.
2. **In-process per-job timer** — each claim arms a `setTimeout` for `REVIEW_TIMEOUT_MIN` (default 15). On fire, the worker writes `status='error', error_message='timeout: job exceeded N min'` and aborts the executor.
3. **Periodic sweeper** — once a minute the worker queries `WHERE status='running' AND started_at < now() - REVIEW_TIMEOUT_MIN` and errors any matches. This catches cases where (1) and (2) both missed.

If you ever need to manually intervene (e.g. the worker is hard-hung and you want to free up the user's slot before restarting):

```sql
-- Force a single job to error.
update public.review_jobs
   set status        = 'error',
       completed_at  = now(),
       error_message = 'manual intervention'
 where id = '<JOB-UUID>'
   and status = 'running';

-- Bulk: error every running job (e.g. before a restart).
update public.review_jobs
   set status        = 'error',
       completed_at  = now(),
       error_message = 'manual intervention before maintenance'
 where status = 'running';
```

The user sees the friendly "what now" line on `/jobs/:id` and can click Re-run.

To **delete** a job entirely (reviews row + chunks both cascade):

```sql
delete from public.review_jobs where id = '<JOB-UUID>';
```

## Health endpoint

`GET /api/health` is public, no auth. Returns:

```json
{
  "ok": true,
  "queueDepth": 2,
  "oldestPendingAgeSec": 47,
  "errorsLast24h": 1
}
```

- `queueDepth` — count of `pending` jobs.
- `oldestPendingAgeSec` — age of the oldest pending row, or `null` if none.
- `errorsLast24h` — count of `status='error'` rows with `completed_at` in the last 24h.
- `ok` flips to `false` if any of the underlying queries fails (response is still 200; the value tells you which field is `null`).

Use it from a deploy platform's health check or a curl one-liner. Don't put it in front of the user — the cap-related rejection in `/api/jobs` already gives them all the info they need.

## Tunable knobs

| Env var                      | Default | Where               | What                                                                 |
| ---------------------------- | ------- | ------------------- | -------------------------------------------------------------------- |
| `MAX_JOBS_PER_USER`          | `1`     | Next.js             | Maximum pending+running jobs per user. >1 effectively disables cap.  |
| `REVIEW_TIMEOUT_MIN`         | `15`    | worker              | Per-job wall-clock budget (minutes). Drives both timer and sweeper.  |
| `WORKER_SWEEP_INTERVAL_SEC`  | `60`    | worker              | Cadence of the periodic stuck-job sweeper.                           |
| `WORKER_RECONNECT_MIN_MS`    | `1000`  | worker              | Initial pg reconnect delay (doubles up to MAX).                      |
| `WORKER_RECONNECT_MAX_MS`    | `30000` | worker              | Cap on the pg reconnect delay.                                       |
| `LOG_LEVEL`                  | `info`  | Next.js + worker    | pino level: `trace` `debug` `info` `warn` `error` `fatal`.           |
| `LOG_PRETTY`                 | unset   | Next.js + worker    | `1` swaps in pino-pretty for human-friendly local dev.               |
| `REVIEW_EXECUTOR`            | `opencode` | worker           | `stub` runs a deterministic fake executor (useful with no API key).  |
| `REVIEW_MODEL`               | `opencode-zen/glm-4.7` | worker | `<provider>/<model>` for `opencode`.                                 |

Changing any of these requires restarting the relevant process; nothing is hot-reloadable.

## Retention (deferred)

Phase 7 deferred scheduled retention to post-beta. The plan was: delete `review_chunks` older than 7 days, delete `review_jobs` with `status='error'` older than 30 days, keep `reviews` forever. The SQL is sketched here for when storage starts mattering — copy/paste into Studio when you need it, no `pg_cron` setup required.

```sql
-- Drop streamed chunks older than 7 days. Reviews remain because the
-- structured NarrativeReview is stored in the `reviews` table separately.
delete from public.review_chunks where created_at < now() - interval '7 days';

-- Drop errored jobs older than 30 days (cascades to their chunks).
delete from public.review_jobs
 where status = 'error'
   and completed_at < now() - interval '30 days';

-- (Optional) drop cancelled jobs older than 30 days too.
delete from public.review_jobs
 where status = 'cancelled'
   and cancelled_at < now() - interval '30 days';
```

If/when this becomes a routine job, install `pg_cron` (extension exists in the vendored Supabase image but isn't loaded), wrap the statements above in `cron.schedule(...)`, and document the schedule here.

## Log shape

Every server-side line is a single JSON object. Keys you'll see often:

| Key             | Type      | Meaning                                                    |
| --------------- | --------- | ---------------------------------------------------------- |
| `level`         | int       | pino level (30=info, 40=warn, 50=error, 60=fatal).         |
| `time`          | int       | Unix-ms timestamp.                                         |
| `pid`           | int       | Process id.                                                |
| `hostname`      | string    | Host where the line originated.                            |
| `msg`           | string    | The human-readable line.                                   |
| `job_id`        | string    | UUID of the review job. Present on every job-scoped line.  |
| `worker_id`     | string    | UUID assigned per worker session (changes on reconnect).   |
| `user_id`       | string    | Supabase auth user id, on API lines that touch a session.  |
| `err`           | object    | Pino's serialised error (`type`, `message`, `stack`).      |
| `source_job_id` | string    | On `/api/jobs/:id/rerun` lines — the job being re-run.     |
| `signal`        | string    | On worker shutdown lines — `SIGINT` or `SIGTERM`.          |
| `backoff_ms`    | int       | On worker reconnect lines — the next backoff delay.        |

To trace a single review end-to-end:

```bash
# Pipe both processes' logs together.
( docker logs -f enhanced-review-worker & docker logs -f enhanced-review-web ) \
  2>&1 | grep --line-buffered '"job_id":"<JOB-UUID>"' | jq -c .
```

The same `job_id` shows up in `/api/jobs` (creation), `/api/jobs/:id/rerun` (re-runs), `/api/jobs/:id/cancel`, and every worker line. The API doesn't tag every line with `job_id` (some routes don't have one in scope) — when in doubt grep by `user_id`.
