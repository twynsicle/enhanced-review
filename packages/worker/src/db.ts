import type { ClaimedJob, JobStatus } from './types';

/**
 * Database operations the worker performs over a raw `pg` connection.
 * Kept as plain functions (not a class) so tests can substitute a fake
 * Client without inheritance gymnastics.
 *
 * Why not the supabase-js client? Two reasons:
 *   1. supabase-js doesn't expose `LISTEN/NOTIFY` — we need a long-lived
 *      pg connection for that anyway.
 *   2. Claim has to use `FOR UPDATE SKIP LOCKED`, which requires raw SQL.
 *
 * The {@link Querier} interface is the minimum surface these functions
 * need — pg.Client satisfies it, and so do the lightweight fakes in
 * `db.test.ts` / `stub.test.ts` without needing to model pg's full
 * overload set.
 */

export interface QueryResultLike<R> {
  rows: R[];
  rowCount?: number | null;
}

export interface Querier {
  query<R>(sql: string, params?: unknown[]): Promise<QueryResultLike<R>>;
}

/**
 * Mark every row stuck in `running` as `error` with `worker_crashed`.
 * Single-worker crash recovery — at session start we know any row in
 * `running` is left over from a previous worker process that died before
 * completing the job. We surface it to the user (who can re-run from the
 * UI) rather than silently retrying — matches the "manual re-run only"
 * policy decided in Phase 7.
 */
export async function markRunningAsCrashed(pg: Querier): Promise<number> {
  const result = await pg.query(
    `update public.review_jobs
       set status = 'error',
           completed_at = now(),
           error_message = 'worker crashed before the review finished'
     where status = 'running'`,
  );
  return result.rowCount ?? 0;
}

/**
 * Mark a single in-flight job as `error` because its in-process timeout
 * fired. The session aborts the job's controller right after calling
 * this, so any subsequent finalize attempt by the executor sees
 * `signal.aborted` and exits without writing. The `WHERE status =
 * 'running'` guard makes the call a no-op if the job already finished
 * (lost-the-race case).
 */
export async function markStuckAsTimedOut(
  pg: Querier,
  jobId: string,
  message: string,
): Promise<number> {
  const result = await pg.query(
    `update public.review_jobs
       set status = 'error',
           completed_at = now(),
           error_message = $2
     where id = $1
       and status = 'running'`,
    [jobId, message],
  );
  return result.rowCount ?? 0;
}

/**
 * Periodic safety net: error any `running` job whose `started_at` is
 * older than the timeout threshold. The in-process per-job timer is the
 * primary mechanism — this exists to catch jobs we lost track of (e.g.
 * the worker hung hard, or our setTimeout never fired for some reason).
 */
export async function sweepStuckJobs(pg: Querier, timeoutMs: number): Promise<number> {
  const result = await pg.query(
    `update public.review_jobs
       set status = 'error',
           completed_at = now(),
           error_message = 'timeout: job exceeded REVIEW_TIMEOUT_MIN'
     where status = 'running'
       and started_at < now() - ($1::bigint * interval '1 millisecond')`,
    [timeoutMs],
  );
  return result.rowCount ?? 0;
}

/**
 * Atomically claim the oldest pending job for this worker.
 * `FOR UPDATE SKIP LOCKED` ensures concurrent workers don't fight over
 * the same row. Returns null when there's nothing to claim.
 */
export async function claimNext(pg: Querier, workerId: string): Promise<ClaimedJob | null> {
  const result = await pg.query<ClaimedJob>(
    `update public.review_jobs
       set status = 'running', started_at = now(), worker_id = $1
     where id = (
       select id from public.review_jobs
       where status = 'pending'
       order by created_at
       limit 1
       for update skip locked
     )
     returning id, user_id, github_login, target, head_sha`,
    [workerId],
  );
  return result.rows[0] ?? null;
}

/**
 * Read the current status of a job. Used between chunks to detect
 * cancellation. Returns null if the row was deleted (shouldn't happen
 * in normal operation; treated by callers as an exit condition).
 */
export async function selectStatus(pg: Querier, jobId: string): Promise<JobStatus | null> {
  const result = await pg.query<{ status: JobStatus }>(
    `select status from public.review_jobs where id = $1`,
    [jobId],
  );
  return result.rows[0]?.status ?? null;
}
