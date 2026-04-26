# Operations

Day-to-day runbook for the closed-beta deployment. The architecture
overview lives in [docs/README.md](README.md); first-time setup is in
[docs/RUNNING.md](RUNNING.md). This file is for "the thing's running,
now what."

## Quick reference

| Want to…                            | See                                                    |
| ----------------------------------- | ------------------------------------------------------ |
| Add or remove a beta user           | [Allowlist management](#allowlist-management)          |
| Rotate the opencode-zen API key     | [Rotating the opencode-zen key](#rotating-the-opencode-zen-key) |
| Tail server logs                    | [Viewing logs](#viewing-logs)                          |
| Re-run a stuck job                  | [Re-running a stuck job](#re-running-a-stuck-job)      |
| Check queue health                  | [Health endpoint](#health-endpoint)                    |
| Adjust per-job timeout / concurrency| [Tunable knobs](#tunable-knobs)                        |
| Clean up old chunks / errored jobs  | [Retention (deferred)](#retention-deferred)            |
| Inspect the pino log shape          | [Log shape](#log-shape)                                |

---

## Allowlist management

Beta access is gated by the PocketBase `allowed_users` collection
(`github_login` field, unique). All collection rules are `null`, so only
a superuser (the Next.js server's admin client, or a human signed in to
the PB admin UI) can read or write it.

Day-to-day, do this through the admin UI at <http://127.0.0.1:8090/_/>:

- **Add a user**: Collections → allowed_users → **+ New record** →
  `github_login` = the GitHub handle → Create.
- **Remove a user**: find the row → row menu → Delete. Any active
  session of theirs is rejected on their next request (the middleware
  re-checks the allowlist per request).
- **List**: the collection table view is the list.

Removing a user does not delete their reviews — the `reviews` and
`review_jobs` collections allow any signed-in beta member to read any
row (closed-beta workspace model). To purge their reviews, find their
`users` record id and delete the matching `review_jobs` rows (chunks
and reviews cascade via the `job` relation).

## Rotating the opencode-zen key

The key is read from the Next.js server's environment as
`OPENCODE_ZEN_API_KEY` and never stored in the database.

1. Generate a new key in the opencode-zen dashboard.
2. Update the value in `.env.local` (local) or your container
   orchestrator's secret store (deployed).
3. Restart the Next.js process so it picks up the new env. There is no
   separate worker — restarting `npm run dev` (or your equivalent
   `next start` orchestrator) is the entire rotation.
4. Revoke the old key.

Currently-running jobs can't pick up a new key mid-flight. They either
finish on the old key (if the rotation happened after `opencode`
started) or fail with an executor error (if it happened mid-stream);
either way they end as `done` or `error` and the user can re-run.

## Viewing logs

The Next.js process emits single-line JSON via [pino](https://getpino.io).
Job-scoped lines carry `job_id`; the runner adds `executor` (`opencode`
or `stub`).

```bash
# Local dev: lines stream to the npm run dev terminal. Set LOG_PRETTY=1
# in .env.local to swap in pino-pretty (colourised, human-friendly).

# Deployed: capture stdout however your orchestrator captures any other
# Next.js stdout, then filter with jq:
your-log-cmd | jq -c 'select(.job_id == "<JOB-ID>")'
```

PocketBase has its own logs in the admin UI at **Settings → Logs**, with
filterable level + free-text search. Useful when an `update` or `create`
call fails — PB obscures rule failures as 404, but the request log
shows the rule that blocked it.

## Re-running a stuck job

The runner has two layers of stuck-job protection:

1. **In-process per-job timer** — each `runJob` call arms a `setTimeout`
   for `REVIEW_TIMEOUT_MIN` (default 15). On fire, the route handler
   writes `status='error', error_message='timeout: job exceeded N min'`
   and aborts the registered `AbortController`.
2. **Cancellation** — the `/api/jobs/[id]/cancel` route updates the row
   under the user's PB session and signals the registered controller.
   The runner's finally block re-applies `status='cancelled'` to handle
   the narrow race where `markRunning` overwrote the cancel.

There is **no boot-time crash recovery sweep** any more (it lived in
the old worker). If the Next.js process crashes mid-job, the row is
left at `status='running'` with no controller registered. To clean
those up manually, in the PB admin UI:

- Collections → review_jobs → filter `status = "running"` → for each
  stuck row, edit and set `status = "error"`,
  `error_message = "server crashed before the review finished"`,
  `completed_at = <now>`.

The user sees the friendly "what now" line on `/jobs/:id` and can
click Re-run.

To **delete** a job entirely (review + chunks cascade via the `job`
relation): delete the `review_jobs` row in the admin UI.

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

| Env var                | Default                | Read by  | What                                                                 |
| ---------------------- | ---------------------- | -------- | -------------------------------------------------------------------- |
| `MAX_JOBS_PER_USER`    | `1`                    | Next.js  | Maximum pending+running jobs per user. >1 effectively disables cap.  |
| `REVIEW_TIMEOUT_MIN`   | `15`                   | Next.js  | Per-job wall-clock budget (minutes). Drives the per-job timer.       |
| `REVIEW_EXECUTOR`      | `opencode`             | Next.js  | `stub` runs a deterministic fake executor (useful with no API key).  |
| `REVIEW_MODEL`         | `opencode-zen/glm-4.7` | Next.js  | `<provider>/<model>` for `opencode`.                                 |
| `OPENCODE_ZEN_API_KEY` | unset                  | Next.js  | Required when `REVIEW_EXECUTOR=opencode`.                            |
| `LOG_LEVEL`            | `info`                 | Next.js  | pino level: `trace` `debug` `info` `warn` `error` `fatal`.           |
| `LOG_PRETTY`           | unset                  | Next.js  | `1` swaps in pino-pretty for human-friendly local dev.               |

Changing any of these requires restarting the Next.js process; nothing
is hot-reloadable.

## Retention (deferred)

Plan: delete `review_chunks` older than 7 days, delete `review_jobs`
with `status='error'` older than 30 days, keep `reviews` forever.

Once this becomes routine, add a PocketBase
[scheduled job](https://pocketbase.io/docs/js-overview/) under
`pb_migrations/` (or `pb_hooks/` if we add one) that runs the deletes
on a cron expression. PB's JSVM exposes `cronAdd(name, expr, handler)`
for this. Until then, do it manually in the admin UI when storage
starts mattering — the `review_jobs` collection's filter syntax
(`status = "error" && completed_at < "2026-01-01"`) makes ad-hoc
purges easy.

## Log shape

Every server-side line is a single JSON object. Keys you'll see often:

| Key             | Type      | Meaning                                                    |
| --------------- | --------- | ---------------------------------------------------------- |
| `level`         | int       | pino level (30=info, 40=warn, 50=error, 60=fatal).         |
| `time`          | int       | Unix-ms timestamp.                                         |
| `pid`           | int       | Process id.                                                |
| `hostname`      | string    | Host where the line originated.                            |
| `msg`           | string    | The human-readable line.                                   |
| `job_id`        | string    | PB id of the review job. Present on every job-scoped line. |
| `executor`      | string    | `opencode` or `stub`. Set by the runner on its child logger. |
| `user_id`       | string    | PB auth user id, on API lines that touch a session.        |
| `err`           | object    | Pino's serialised error (`type`, `message`, `stack`).      |
| `source_job_id` | string    | On `/api/jobs/:id/rerun` lines — the job being re-run.     |

To trace a single review end-to-end, filter by `job_id` — the same id
shows up in `/api/jobs` (creation), `/api/jobs/:id/rerun` (re-runs),
`/api/jobs/:id/cancel`, and every runner line.
