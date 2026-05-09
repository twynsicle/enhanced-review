import 'server-only';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';
import { logger } from '@/lib/log';

/**
 * Boot-time invariant restoration. If the previous container died mid-job
 * (deploy, crash, OOM), we'll find rows in `running` with no in-process
 * runner. Mark them as errored so the live view doesn't hang forever.
 *
 * Idempotent: if there are no orphaned rows, this is a no-op SELECT.
 */
export async function recoverInterruptedJobs(): Promise<void> {
  let result: { id: string; userId: string }[] = [];
  try {
    result = await db
      .update(reviewJobs)
      .set({
        status: 'error',
        completedAt: new Date(),
        errorMessage: 'Container restarted; in-flight job lost',
        updatedAt: new Date(),
      })
      .where(eq(reviewJobs.status, 'running'))
      .returning({ id: reviewJobs.id, userId: reviewJobs.userId });
  } catch (err) {
    logger.error({ err }, '[recover] update failed');
    return;
  }

  if (result.length === 0) return;
  logger.info({ count: result.length }, '[recover] flipped orphan running rows to error');

  for (const row of result) {
    try {
      await pool.query('SELECT pg_notify($1, $2)', [
        `job_${row.id}`,
        JSON.stringify({
          type: 'status',
          status: 'error',
          errorMessage: 'Container restarted; in-flight job lost',
        }),
      ]);
      await pool.query('SELECT pg_notify($1, $2)', [
        `user_${row.userId}:terminal`,
        JSON.stringify({ jobId: row.id, status: 'error' }),
      ]);
    } catch (err) {
      logger.warn({ err, job_id: row.id }, '[recover] notify failed');
    }
  }
}
