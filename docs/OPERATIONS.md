# Operations

Day-to-day runbook for the closed-beta deployment. The architecture
overview lives in [docs/README.md](README.md); first-time setup is in
[docs/RUNNING.md](RUNNING.md). This file is for "the thing's running,
now what."

## Quick reference

| Want to…                             | See                                                               |
| ------------------------------------ | ----------------------------------------------------------------- |
| Add or remove a beta user            | [Allowlist management](#allowlist-management)                     |
| Rotate the Anthropic API key         | [Rotating the Anthropic API key](#rotating-the-anthropic-api-key) |
| Tail server logs                     | [Viewing logs](#viewing-logs)                                     |
| Re-run a stuck job                   | [Re-running a stuck job](#re-running-a-stuck-job)                 |
| Check queue health                   | [Health endpoint](#health-endpoint)                               |
| Adjust per-job timeout / concurrency | [Tunable knobs](#tunable-knobs)                                   |
| Clean up old chunks / errored jobs   | [Retention (deferred)](#retention-deferred)                       |
| Inspect the pino log shape           | [Log shape](#log-shape)                                           |

---

## Allowlist management

Beta access is gated by the `allowed_users` Postgres table
(`github_login` column, unique). Two enforcement layers — Auth.js's
`signIn` callback (refuses the OAuth handshake) and `src/proxy.ts`
(re-checks every request).

Day-to-day, manage rows via SQL. Locally:

```bash
docker compose exec postgres psql -U app enhanced_review
```

```sql
-- List
SELECT github_login, created_at FROM allowed_users ORDER BY created_at;

-- Add a user (idempotent)
INSERT INTO allowed_users (github_login)
VALUES ('handle')
ON CONFLICT (github_login) DO NOTHING;

-- Remove a user. Their next request is rejected by the middleware.
DELETE FROM allowed_users WHERE github_login = 'handle';
```

The `npm run db:seed` script does the equivalent INSERT for the
`SEED_GITHUB_LOGIN` env var — handy for first-run scripted seeding.

Removing a user does not delete their reviews — the `reviews` and
`review_jobs` rows allow any signed-in beta member to read any row
(closed-beta workspace model). To purge their reviews, look up their
`users.id` (`SELECT id FROM users WHERE github_login = '...'`) and
delete the matching `review_jobs` rows; chunks and reviews cascade via
the `job_id` foreign key.

In ECS (post-Phase C), use `aws ecs execute-command` to open a shell
into the running task and run the same `psql` commands.

## Rotating the Anthropic API key

The key is read from the Next.js server's environment as
`ANTHROPIC_API_KEY` and never stored in the database. The Claude Agent
SDK reads it directly from `process.env`.

1. Generate a new key at <https://console.anthropic.com> → API Keys.
2. Update the value in `.env.local` (local) or AWS Secrets Manager (deployed).
3. Restart the Next.js process so it picks up the new env. There is no
   separate worker — restarting `npm run dev` (or your equivalent
   `next start` orchestrator) is the entire rotation.
4. Revoke the old key.

Currently-running jobs can't pick up a new key mid-flight. They either
finish on the old key (if the rotation happened after the Claude SDK
session started) or fail with an executor error (if it happened
mid-stream); either way they end as `done` or `error` and the user can
re-run.

## Viewing logs

The Next.js process emits single-line JSON via [pino](https://getpino.io).
Job-scoped lines carry `job_id`; the runner adds `executor` (`claude`
or `stub`).

```bash
# Local dev: lines stream to the npm run dev terminal. Set LOG_PRETTY=1
# in .env.local to swap in pino-pretty (colourised, human-friendly).

# Deployed: capture stdout however your orchestrator captures it
# (CloudWatch via the awslogs driver in ECS), then filter with jq:
your-log-cmd | jq -c 'select(.job_id == "<JOB-ID>")'
```

Postgres has its own logs in the container; `docker compose logs postgres`
locally, CloudWatch in ECS. Useful when an UPDATE returns zero rows and
you need to see the actual SQL the driver sent.

## Re-running a stuck job

The runner has three layers of stuck-job protection:

1. **In-process per-job timer** — each `runJob` call arms a `setTimeout`
   for `REVIEW_TIMEOUT_MIN` (default 15). On fire, the route handler
   writes `status='error', error_message='timeout: job exceeded N min'`,
   emits NOTIFYs, and aborts the registered `AbortController`.
2. **Cancellation** — the `/api/jobs/[id]/cancel` route runs an UPDATE
   guarded by `WHERE status IN ('pending','running')` and returns 409
   when zero rows match. Then it signals the registered controller and
   emits NOTIFYs.
3. **Boot-time recovery** — `instrumentation.ts` runs
   `recoverInterruptedJobs()` once per server start, flipping any
   `running` rows from a previous (crashed/restarted) container to
   `error: 'Container restarted; in-flight job lost'`. Cheap; no-op if
   there are no orphans.

If you ever need to manually clean a stuck row:

```sql
UPDATE review_jobs
SET status = 'error',
    completed_at = now(),
    error_message = 'manual cleanup'
WHERE status = 'running'
  AND id = '...';
```

The user sees the friendly "what now" line on `/jobs/:id` and can
click Re-run.

To **delete** a job entirely (review + chunks cascade via the `job_id` FK):
`DELETE FROM review_jobs WHERE id = '...';`.

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

Use it from a deploy platform's health check or a curl one-liner.

## Tunable knobs

| Env var              | Default            | Read by      | What                                                                |
| -------------------- | ------------------ | ------------ | ------------------------------------------------------------------- |
| `DATABASE_URL`       | (none)             | Next.js, db scripts | Postgres connection string. Required.                        |
| `AUTH_SECRET`        | (none)             | Auth.js v5   | Secret for signing session cookies / CSRF tokens. Required.         |
| `AUTH_URL`           | dev: localhost:3000 | Auth.js v5  | Public origin for OAuth callback URL construction.                  |
| `AUTH_GITHUB_ID`     | (none)             | Auth.js v5   | GitHub OAuth app client id.                                          |
| `AUTH_GITHUB_SECRET` | (none)             | Auth.js v5   | GitHub OAuth app client secret.                                      |
| `SEED_GITHUB_LOGIN`  | unset              | `db:seed`    | `npm run db:seed` inserts this into `allowed_users`. No-op if unset. |
| `MAX_JOBS_PER_USER`  | `1`                | Next.js      | Maximum pending+running jobs per user.                               |
| `REVIEW_TIMEOUT_MIN` | `15`               | Next.js      | Per-job wall-clock budget (minutes).                                 |
| `REVIEW_EXECUTOR`    | `claude`           | Next.js      | `stub` runs a deterministic fake executor (no API key needed).      |
| `REVIEW_MODEL`       | `claude-haiku-4-5` | Next.js      | Claude model id passed to the Claude Agent SDK.                     |
| `ANTHROPIC_API_KEY`  | unset              | Next.js      | Required when `REVIEW_EXECUTOR=claude`. Read by the SDK from env.   |
| `LOG_LEVEL`          | `info`             | Next.js      | pino level: `trace` `debug` `info` `warn` `error` `fatal`.          |
| `LOG_PRETTY`         | unset              | Next.js      | `1` swaps in pino-pretty for human-friendly local dev.              |

Changing any of these requires restarting the Next.js process; nothing
is hot-reloadable.

## Retention (deferred)

Plan: delete `review_chunks` older than 7 days, delete `review_jobs`
with `status='error'` older than 30 days, keep `reviews` forever.

Once this becomes routine, add a `pg_cron` job (or schedule the deletes
from `instrumentation.ts` with a `setInterval`). The Postgres extension
makes this a one-line SQL config; until then, do it manually:

```sql
DELETE FROM review_chunks WHERE created_at < now() - interval '7 days';
DELETE FROM review_jobs WHERE status = 'error' AND completed_at < now() - interval '30 days';
```

## Log shape

Every server-side line is a single JSON object. Keys you'll see often:

| Key             | Type   | Meaning                                                    |
| --------------- | ------ | ---------------------------------------------------------- |
| `level`         | int    | pino level (30=info, 40=warn, 50=error, 60=fatal).         |
| `time`          | int    | Unix-ms timestamp.                                         |
| `pid`           | int    | Process id.                                                |
| `hostname`      | string | Host where the line originated.                            |
| `msg`           | string | The human-readable line.                                   |
| `job_id`        | string | UUID of the review job. Present on every job-scoped line.  |
| `executor`      | string | `claude` or `stub`. Set by the runner on its child logger. |
| `user_id`       | string | Auth.js user id, on API lines that touch a session.        |
| `err`           | object | Pino's serialised error (`type`, `message`, `stack`).      |
| `source_job_id` | string | On `/api/jobs/:id/rerun` lines — the job being re-run.     |

To trace a single review end-to-end, filter by `job_id` — the same id
shows up in `/api/jobs` (creation), `/api/jobs/:id/rerun` (re-runs),
`/api/jobs/:id/cancel`, every runner line, and the SSE handler at
`/api/jobs/:id/stream`.
