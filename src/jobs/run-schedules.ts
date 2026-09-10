import { recoverClaimedSchedules, runOnce } from '../domain/schedules/scheduler.server.ts';
import type { SchedulerTickResult } from '../domain/schedules/tick.server.ts';
import { UsageError } from './errors.ts';

/**
 * `npm run job -- run-schedules`
 *
 * Releases stale claims and runs exactly one scheduler tick, then exits. The
 * server does both on its own — this is for an operator who wants a pass
 * without waiting out `SCHEDULER_TICK_MS`, or who runs with
 * `SCHEDULER_ENABLED=0` and drives the loop from cron instead.
 *
 * It needs `SCHEDULER_GITHUB_TOKEN`, and it starts real reviews.
 */
export async function runSchedules(args: string[]): Promise<SchedulerTickResult> {
  if (args.length > 0) throw new UsageError('run-schedules takes no arguments');
  await recoverClaimedSchedules();
  return runOnce();
}
