import { logger } from '../../common/logger.ts';
import { recoverOrphanedJobs } from './recover-jobs.server.ts';

/**
 * One-time job-runner boot, awaited by `entry.server.tsx` before the first
 * request is served: recover orphans left by the previous process. Guarded
 * on `globalThis` so Vite re-evaluating the server entry in development
 * (HMR) does not error jobs that are running right now. A database that is
 * unreachable here is logged, not fatal — `/api/health` reports it.
 */
export const JOBS_BOOTED_KEY: unique symbol = Symbol.for('enhanced-review.jobs.booted');

const globalSlot = globalThis as unknown as Record<typeof JOBS_BOOTED_KEY, boolean | undefined>;

export async function bootJobs(
  recover: () => Promise<number> = recoverOrphanedJobs,
): Promise<void> {
  if (globalSlot[JOBS_BOOTED_KEY]) return;
  globalSlot[JOBS_BOOTED_KEY] = true;
  try {
    await recover();
  } catch (err) {
    logger.error({ err }, 'orphan recovery failed at boot');
  }
}
