# Operations

Runbook for a running deployment. Setup and architecture are in the
[README](../README.md); this file is for "it's running, now what".

The app ships as **one image running one process**, with Postgres beside it.
Everything below is written against `docker compose`, which is what this
repository actually contains and what the commands were verified on. On any
other container host the same commands apply — substitute your own way of
setting environment variables, reading logs and running a one-off container.

## Quick reference

| Want to…                   | See                                                 |
| -------------------------- | --------------------------------------------------- |
| Understand who can sign in | [Access control](#access-control)                   |
| Change a setting           | [Configuration](#configuration)                     |
| Check the app is healthy   | [Health endpoint](#health-endpoint)                 |
| Read the logs              | [Logs](#logs)                                       |
| Deal with a stuck job      | [Stuck and orphaned jobs](#stuck-and-orphaned-jobs) |
| Rotate the Anthropic key   | [Rotating secrets](#rotating-secrets)               |
| Sign everyone out          | [Rotating secrets](#rotating-secrets)               |
| Apply a schema change      | [Migrations and deploys](#migrations-and-deploys)   |
| Back up or restore         | [Backups](#backups)                                 |
| Delete old jobs and chunks | [Retention](#retention)                             |

---

## Access control

**There is none inside the app beyond GitHub sign-in.** Anyone with a GitHub
account who reaches the deployment can sign in, start reviews against their own
repositories, and read every review anyone else has run. The only per-user
check is on cancellation: a job may be cancelled by its owner alone.

An `allowed_users` allowlist used to gate this. It was removed, so the network
boundary in front of the deployment — VPN, SSO proxy, IP allowlist, or simply
not exposing it publicly — is now the entire access control story. Treat a
publicly reachable deployment as public.

To cut off one person, delete their `users` row. Their sessions cascade with
it and their next request lands on `/login`. This also deletes their jobs and
reviews:

```sql
DELETE FROM users WHERE github_login = 'octocat';
```

To keep the reviews and only revoke access, delete their sessions instead —
though nothing stops them signing in again:

```sql
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE github_login = 'octocat');
```

Open a psql shell with:

```bash
docker compose exec postgres psql -U enhanced_review -d enhanced_review
```

## Configuration

Every key is declared in `.env.example`, parsed by `src/config/env.ts` at
start-up, and validated — an invalid or missing required value stops the boot
with the key named. **Nothing is hot-reloadable**; changing any of these means
restarting the process.

Required:

| Key                                         | What                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Postgres connection string.                                                            |
| `SESSION_SECRET`                            | Signs both cookies. At least 32 characters.                                            |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | The GitHub OAuth app.                                                                  |
| `APP_ORIGIN`                                | Public origin. Builds the OAuth redirect URI and turns on `Secure` cookies when https. |

Tunable:

| Key                  | Default            | What                                                                        |
| -------------------- | ------------------ | --------------------------------------------------------------------------- |
| `REVIEW_EXECUTOR`    | `claude`           | `stub` streams a canned review and calls no API.                            |
| `REVIEW_MODEL`       | `claude-haiku-4-5` | Model id passed to the Claude Agent SDK.                                    |
| `ANTHROPIC_API_KEY`  | unset              | Required when `REVIEW_EXECUTOR=claude`.                                     |
| `REVIEW_TIMEOUT_MIN` | `15`               | Per-job wall-clock budget. On expiry the job is marked `error` and aborted. |
| `MAX_JOBS_PER_USER`  | `1`                | Pending-or-running jobs one user may have. Raise to loosen the cap.         |
| `LOG_LEVEL`          | `info`             | `trace` `debug` `info` `warn` `error` `fatal` `silent`.                     |
| `LOG_PRETTY`         | unset              | `1` swaps in pino-pretty. Local use only.                                   |
| `LIVE_POLL_MS`       | `2000`             | How often a live job view asks for new chunks.                              |
| `TERMINAL_POLL_MS`   | `10000`            | How often the cross-page notifier checks for finished reviews.              |
| `APP_VERSION`        | unset              | Reported by `/api/health`. The image build sets it.                         |
| `PORT`               | `3000`             | HTTP port.                                                                  |

Both polling intervals are handed to the browser by the app shell and pause
while a tab is hidden. Raising them is the cheapest way to cut load if the
database is under pressure.

## Health endpoint

`GET /api/health` is public and takes no auth. It always returns 200 — a
failed query leaves its field `null` and flips `ok` to `false`, so a green
pinger means "the process is up and answering", not "everything is fine".

```json
{
  "ok": true,
  "version": "aba19ed",
  "db": "ok",
  "queueDepth": 2,
  "oldestPendingAgeSec": 47,
  "errorsLast24h": 1
}
```

- `db` — `ok` when a trivial query succeeded, otherwise `error`. This is the
  field worth alerting on.
- `queueDepth` — jobs sitting in `pending`.
- `oldestPendingAgeSec` — age of the oldest pending job, `null` if none. A
  value climbing past a few minutes means jobs are being created but not run.
- `errorsLast24h` — jobs that completed with `error` in the last 24 hours.

The container's own `HEALTHCHECK` polls this endpoint and only checks that the
response is 200, so it detects a dead process, not a sick one.

## Logs

Single-line JSON via [pino](https://getpino.io), on stdout.

```bash
docker compose logs -f web
```

Job-scoped lines carry `job_id`; runner lines add `executor` (`claude` or
`stub`). To trace one review end to end:

```bash
docker compose logs web | jq -c 'select(.job_id == "<JOB-ID>")'
```

Fields you will see often:

| Key         | Meaning                                             |
| ----------- | --------------------------------------------------- |
| `level`     | pino level: 30 info, 40 warn, 50 error, 60 fatal.   |
| `time`      | Unix-ms timestamp.                                  |
| `msg`       | The human-readable line.                            |
| `job_id`    | The review job. On every runner and job-route line. |
| `executor`  | `claude` or `stub`, bound by the runner.            |
| `user_id`   | On lines that touch a session.                      |
| `err`       | Serialised error: `type`, `message`, `stack`.       |
| `metric`    | On health-endpoint failures, which metric failed.   |
| `clone_dir` | The temporary clone, on clone lines.                |

Set `LOG_LEVEL=debug` for more; `silent` is accepted and turns logging off
entirely.

## Stuck and orphaned jobs

Reviews run in the web process. Three things can leave a job unfinished, and
each is already handled:

1. **A job runs too long.** The per-job timer fires at `REVIEW_TIMEOUT_MIN`,
   writes `error` with `timeout: job exceeded N min`, and aborts the run.
2. **A user cancels.** The cancel action writes `cancelled` and signals the
   runner, which tears down the clone and the SDK iterator.
3. **The process dies mid-job.** Nothing can finish that row. The next start-up
   sweeps every `pending` or `running` job to `error` with
   `interrupted: server restarted`, so the UI stops polling and the user sees
   a re-run button.

That sweep runs automatically on boot. To do it by hand — after a crash, or
before a restart, while the server is down:

```bash
docker compose run --rm web node src/jobs/cli.ts recover-jobs
```

It takes no arguments, is safe to re-run, and prints how many rows it changed.

If a job is somehow stuck outside all three paths, mark it errored directly:

```sql
UPDATE review_jobs
   SET status = 'error',
       error_message = 'cleared by an operator',
       completed_at = now()
 WHERE id = '<JOB-ID>' AND status IN ('pending', 'running');
```

Deleting the `review_jobs` row removes its review and chunks with it, through
`ON DELETE CASCADE`.

## Rotating secrets

**Anthropic API key.** Read from the environment by the Claude Agent SDK and
never stored in the database. Issue a new key, update the environment, restart
the process, then revoke the old one. Jobs already in flight cannot pick up a
new key: they either finish on the old one or fail with an executor error, and
the user can re-run.

**`SESSION_SECRET`.** Signs both cookies, so rotating it invalidates every
session and GitHub token cookie at once — everyone signs in again, and there
is no partial rollout. The `sessions` rows survive but can no longer be
addressed; clear them with `DELETE FROM sessions;` after the restart.

**GitHub OAuth client secret.** Generate the new secret in the GitHub OAuth
app first, then update `GITHUB_CLIENT_SECRET` and restart. Existing sessions
keep working: the client secret is only used during the sign-in exchange.

**A user's GitHub token.** Held only in that user's `gh_access_token` cookie.
If GitHub rejects it, the app redirects them to `/relink` to re-authorise. No
operator action exists or is needed.

## Migrations and deploys

The image's start-up chain is `prisma migrate deploy` → `recover-jobs` →
serve, so a deploy applies pending migrations by itself and a failed migration
stops the container rather than serving against the wrong schema. A fresh
database needs no manual step.

This means a rolling deploy runs migrations from whichever container starts
first, while old containers are still serving. Keep migrations
backwards-compatible with the previous release, or take a moment of downtime.

To check what a database is at:

```bash
docker compose run --rm web ./node_modules/.bin/prisma migrate status
```

## Backups

All durable state is in Postgres — the compose file keeps it in the `pgdata`
volume. There is nothing else to back up: clones are temporary and deleted
after each review, and no secrets live in the database.

```bash
docker compose exec -T postgres pg_dump -U enhanced_review enhanced_review | gzip > er-$(date +%F).sql.gz
```

Restore into an empty database:

```bash
gunzip -c er-2026-09-08.sql.gz | docker compose exec -T postgres psql -U enhanced_review -d enhanced_review
```

## Retention

**Nothing is deleted automatically.** `review_chunks` is the table that grows
fastest — one row per streamed fragment, kept after the review is assembled,
and only ever read by a live view that is watching the job run.

Until this is worth automating, prune by hand. Chunks for finished reviews
older than a week:

```sql
DELETE FROM review_chunks
 WHERE job_id IN (
   SELECT id FROM review_jobs
    WHERE status <> 'running' AND status <> 'pending'
      AND completed_at < now() - interval '7 days'
 );
```

Failed jobs older than a month, with their chunks and any review:

```sql
DELETE FROM review_jobs
 WHERE status = 'error' AND completed_at < now() - interval '30 days';
```

Completed reviews are worth keeping — they are the product. Check what you are
about to remove with the matching `SELECT count(*)` first, and take a backup
before the first run of either statement.
