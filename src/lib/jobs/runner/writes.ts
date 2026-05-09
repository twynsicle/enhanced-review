import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { NarrativeReview } from '@enhanced-review/review-types';
import { db, pool } from '@/lib/db/client';
import { reviewChunks, reviewJobs, reviews } from '@/lib/db/schema';
import { logger } from '@/lib/log';

/**
 * Runner write paths. Each function writes via Drizzle and (where the
 * realtime layer cares) emits a `pg_notify` AFTER the commit so SSE
 * subscribers can SELECT consistent state. NOTIFY payloads are minimal
 * (`{ type, ... }`) — chunk content stays out of the payload to keep
 * under Postgres's 8KB cap.
 *
 * Channels:
 *   - `job_<id>`              per-job stream (chunk inserts + status flips)
 *   - `user_<userId>:terminal` per-user stream, terminal status only
 */

async function notify(channel: string, payload: unknown): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [channel, JSON.stringify(payload)]);
}

export async function markRunning(jobId: string): Promise<void> {
  const now = new Date();
  await db
    .update(reviewJobs)
    .set({ status: 'running', startedAt: now, updatedAt: now })
    .where(eq(reviewJobs.id, jobId));
  await notify(`job_${jobId}`, { type: 'status', status: 'running' });
}

/**
 * Idempotent — `(jobId, seq)` is unique, duplicate inserts are no-ops.
 * Caller (run.ts onChunk) treats this as fire-and-forget; failures land
 * in the inFlight promise array via the standard `.catch`.
 */
export async function insertChunk(jobId: string, seq: number, content: string): Promise<void> {
  await db
    .insert(reviewChunks)
    .values({ jobId, seq, content })
    .onConflictDoNothing({ target: [reviewChunks.jobId, reviewChunks.seq] });
  await notify(`job_${jobId}`, { type: 'chunk', seq });
}

export async function finalizeAsDone(
  jobId: string,
  userId: string,
  content: NarrativeReview,
  options: { diffTruncated?: boolean } = {},
): Promise<void> {
  const riskScore = content.riskAssessment?.score ?? null;
  await db.transaction(async (tx) => {
    await tx.insert(reviews).values({
      jobId,
      content,
      diffTruncated: options.diffTruncated ?? false,
    });
    await tx
      .update(reviewJobs)
      .set({
        status: 'done',
        completedAt: new Date(),
        riskScore,
        updatedAt: new Date(),
      })
      .where(eq(reviewJobs.id, jobId));
  });
  await notify(`job_${jobId}`, { type: 'status', status: 'done', riskScore });
  await notify(`user_${userId}:terminal`, { jobId, status: 'done', riskScore });
}

export async function markErrored(
  jobId: string,
  userId: string,
  message: string,
): Promise<void> {
  const truncated = message.slice(0, 500);
  try {
    await db
      .update(reviewJobs)
      .set({
        status: 'error',
        completedAt: new Date(),
        errorMessage: truncated,
        updatedAt: new Date(),
      })
      .where(eq(reviewJobs.id, jobId));
    await notify(`job_${jobId}`, { type: 'status', status: 'error', errorMessage: truncated });
    await notify(`user_${userId}:terminal`, { jobId, status: 'error' });
  } catch (err) {
    logger.error({ job_id: jobId, err }, 'markErrored failed');
  }
}

/**
 * Idempotent — only writes if the row is still pending/running. Returns
 * the rowcount so callers can distinguish "this call did the cancel" vs
 * "someone beat us to it".
 */
export async function markCancelled(jobId: string, userId: string): Promise<number> {
  const result = await db
    .update(reviewJobs)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reviewJobs.id, jobId),
        inArray(reviewJobs.status, ['pending', 'running']),
      ),
    )
    .returning({ id: reviewJobs.id });
  if (result.length > 0) {
    await notify(`job_${jobId}`, { type: 'status', status: 'cancelled' });
    await notify(`user_${userId}:terminal`, { jobId, status: 'cancelled' });
  }
  return result.length;
}
