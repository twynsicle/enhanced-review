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
 * Reset every job stuck in `running` back to `pending`. Single-worker
 * crash recovery — we assume any row in `running` at boot belongs to a
 * previous boot of this worker that crashed before completing or
 * cancelling. Phase 7 replaces this with heartbeat-based recovery once
 * we run multiple workers.
 */
export async function resetRunning(pg: Querier): Promise<number> {
  const result = await pg.query(
    `update public.review_jobs
       set status = 'pending', worker_id = null, started_at = null
     where status = 'running'`,
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
