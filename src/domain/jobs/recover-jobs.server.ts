import { logger } from '../../common/logger.ts';
import * as reviewJobs from '../../db/review-jobs.ts';

/**
 * Orphan recovery (phase-3-plan P3-D6). Jobs run in-process, so any row
 * still `pending` or `running` when a process starts belonged to a process
 * that is gone; they can never finish. Flip them to `error` so the UI stops
 * polling and the user can rerun. Runs at server boot (`bootJobs`) and as
 * the `recover-jobs` one-shot.
 */
export const RECOVERY_MESSAGE = 'interrupted: server restarted';

export async function recoverOrphanedJobs(
  recover: (message: string) => Promise<number> = reviewJobs.recoverOrphans,
): Promise<number> {
  const count = await recover(RECOVERY_MESSAGE);
  if (count > 0) logger.warn({ count }, 'orphaned jobs marked as errored');
  else logger.info('no orphaned jobs');
  return count;
}
