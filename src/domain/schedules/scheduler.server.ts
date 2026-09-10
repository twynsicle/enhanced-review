import { logger } from '../../common/logger.ts';
import { env } from '../../config/env.ts';
import * as reviewSchedules from '../../db/review-schedules.ts';
import {
  defaultSchedulerTickDeps,
  runSchedulerTick,
  type SchedulerTickDeps,
  type SchedulerTickResult,
} from './tick.server.ts';

/**
 * The scheduler loop: a `setInterval` that runs one tick every
 * `SCHEDULER_TICK_MS`, started once per process from `bootJobs()`.
 *
 * It lives in the same process as the review runner for the same reason the
 * runner does — the app is one container, one process. A second instance
 * would tick too, and while the conditional claim keeps two ticks from taking
 * the same schedule, two instances would still halve the interval between
 * runs. `SCHEDULER_ENABLED=0` is how you keep a second instance quiet.
 *
 * Like the job registry, the handle is parked on `globalThis` under a
 * `Symbol.for` key: Vite re-evaluates this module on every server change in
 * development, and without that a day's editing would leave a dozen intervals
 * behind.
 */
export const SCHEDULER_KEY: unique symbol = Symbol.for('enhanced-review.schedules.scheduler');

export type SchedulerStart = 'started' | 'already-running' | 'disabled' | 'no-token';

interface SchedulerHandle {
  timer: ReturnType<typeof setInterval>;
  /** A tick that overruns the interval must not have a second one on top. */
  ticking: boolean;
}

const globalSlot = globalThis as unknown as Record<
  typeof SCHEDULER_KEY,
  SchedulerHandle | undefined
>;

/**
 * Run one pass. Exported for `npm run job -- run-schedules`, which is how an
 * operator forces a tick without waiting for the interval.
 */
export function runOnce(deps?: SchedulerTickDeps): Promise<SchedulerTickResult> {
  const token = env.SCHEDULER_GITHUB_TOKEN;
  if (!deps && !token) {
    return Promise.reject(new Error('SCHEDULER_GITHUB_TOKEN is not set'));
  }
  return runSchedulerTick(deps ?? defaultSchedulerTickDeps(token ?? ''));
}

/**
 * Release every claim left behind by a process that died mid-tick. Nothing
 * else clears a `running` schedule — the claim is only given back by the tick
 * that took it — so without this a crash would park a schedule forever.
 */
export async function recoverClaimedSchedules(
  release: (now?: Date) => Promise<number> = reviewSchedules.releaseClaimedSchedules,
): Promise<number> {
  const count = await release();
  if (count > 0) logger.warn({ count }, 'released schedules claimed by a previous process');
  return count;
}

export function startScheduler(): SchedulerStart {
  if (globalSlot[SCHEDULER_KEY]) return 'already-running';
  if (!env.SCHEDULER_ENABLED) {
    logger.info('scheduler disabled (SCHEDULER_ENABLED=0)');
    return 'disabled';
  }
  const token = env.SCHEDULER_GITHUB_TOKEN;
  if (!token) {
    // Not an error: schedules are still created, listed and paused; nothing
    // fires until an operator gives the loop something to clone with.
    logger.warn('scheduler idle: SCHEDULER_GITHUB_TOKEN is not set');
    return 'no-token';
  }

  const deps = defaultSchedulerTickDeps(token);
  const handle: SchedulerHandle = {
    ticking: false,
    timer: setInterval(() => {
      if (handle.ticking) {
        logger.warn('scheduler tick still running; skipping this interval');
        return;
      }
      handle.ticking = true;
      void runSchedulerTick(deps)
        .then((result) => {
          if (result.claimed > 0) logger.info(result, 'scheduler tick');
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'scheduler tick failed');
        })
        .finally(() => {
          handle.ticking = false;
        });
    }, env.SCHEDULER_TICK_MS),
  };
  // The loop must never be the reason the process stays up.
  handle.timer.unref();
  globalSlot[SCHEDULER_KEY] = handle;
  logger.info({ tick_ms: env.SCHEDULER_TICK_MS }, 'scheduler started');
  return 'started';
}

export function stopScheduler(): void {
  const handle = globalSlot[SCHEDULER_KEY];
  if (!handle) return;
  clearInterval(handle.timer);
  globalSlot[SCHEDULER_KEY] = undefined;
}
