import { logger } from '../../common/logger.ts';
import {
  recoverClaimedSchedules,
  startScheduler,
  type SchedulerStart,
} from '../schedules/scheduler.server.ts';
import { recoverOrphanedJobs } from './recover-jobs.server.ts';

/**
 * One-time job-runner boot, awaited by `entry.server.tsx` before the first
 * request is served:
 *
 *   1. error the jobs orphaned by the previous process,
 *   2. release the schedules that process had claimed,
 *   3. start the scheduler loop.
 *
 * Steps 1 and 2 are the same idea applied to two tables — anything left
 * mid-flight belongs to a process that is gone — and both must happen before
 * the loop starts, or the first tick would skip every schedule stuck in
 * `running`. Guarded on `globalThis` so Vite re-evaluating the server entry
 * in development (HMR) does not error jobs that are running right now, and
 * does not stack a second interval. A database that is unreachable here is
 * logged, not fatal — `/api/health` reports it.
 */
export const JOBS_BOOTED_KEY: unique symbol = Symbol.for('enhanced-review.jobs.booted');

const globalSlot = globalThis as unknown as Record<typeof JOBS_BOOTED_KEY, boolean | undefined>;

export interface BootJobsDeps {
  recoverJobs: () => Promise<number>;
  recoverSchedules: () => Promise<number>;
  startScheduler: () => SchedulerStart;
}

export function defaultBootJobsDeps(): BootJobsDeps {
  return {
    recoverJobs: recoverOrphanedJobs,
    recoverSchedules: recoverClaimedSchedules,
    startScheduler,
  };
}

export async function bootJobs(deps: BootJobsDeps = defaultBootJobsDeps()): Promise<void> {
  if (globalSlot[JOBS_BOOTED_KEY]) return;
  globalSlot[JOBS_BOOTED_KEY] = true;
  try {
    await deps.recoverJobs();
    await deps.recoverSchedules();
  } catch (err) {
    logger.error({ err }, 'orphan recovery failed at boot');
  }
  deps.startScheduler();
}
