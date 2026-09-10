import { logger } from '../../common/logger.ts';
import { env } from '../../config/env.ts';
import * as reviewSchedules from '../../db/review-schedules.ts';
import { GithubAuthError } from '../github/client.server.ts';
import { HeadShaResolutionError, JobInFlightError } from '../jobs/errors.ts';
import { startReview } from '../jobs/start-review.server.ts';
import type { ReviewTarget } from '../review/target.ts';
import { nextRunAt } from './cadence.ts';
import { parseSchedule } from './schedules.server.ts';

/**
 * One pass of the scheduler.
 *
 *   claim due schedules (active → running, oldest due first)
 *     └─ for each: startReview(owner, machine token, target, scheduleId)
 *          ├─ launched   → completeRun: running → active, next run computed
 *          ├─ in flight  → releaseRun:  running → active, no run recorded
 *          └─ threw      → failRun:     running → active | failed, streak + 1
 *
 * Everything the pass touches is injected, so the whole loop is testable
 * without a database and without GitHub — the same shape `runJob` uses.
 *
 * The claim is what makes a tick safe to overlap with the one before it: two
 * passes can list the same due row, but only one of them can move it out of
 * `active`, and the loser simply skips it.
 */
export interface SchedulerTickDeps {
  claim: typeof reviewSchedules.claimDueSchedules;
  completeRun: typeof reviewSchedules.completeRun;
  releaseRun: typeof reviewSchedules.releaseRun;
  failRun: typeof reviewSchedules.failRun;
  startReview: (input: {
    userId: string;
    token: string;
    target: ReviewTarget;
    scheduleId: string;
  }) => Promise<{ id: string }>;
  /** The machine token scheduled runs clone with (SCHEDULER_GITHUB_TOKEN). */
  token: string;
  batchSize: number;
  maxFailures: number;
  retryBackoffMin: number;
  now: () => Date;
}

export interface SchedulerTickResult {
  claimed: number;
  launched: number;
  /** Put back untouched — the owner was already at their job cap. */
  deferred: number;
  failed: number;
}

export function defaultSchedulerTickDeps(token: string): SchedulerTickDeps {
  return {
    claim: reviewSchedules.claimDueSchedules,
    completeRun: reviewSchedules.completeRun,
    releaseRun: reviewSchedules.releaseRun,
    failRun: reviewSchedules.failRun,
    startReview: (input) =>
      startReview({
        userId: input.userId,
        token: input.token,
        target: input.target,
        scheduleId: input.scheduleId,
      }),
    token,
    batchSize: env.SCHEDULER_BATCH_SIZE,
    maxFailures: env.SCHEDULE_MAX_FAILURES,
    retryBackoffMin: env.SCHEDULE_RETRY_BACKOFF_MIN,
    now: () => new Date(),
  };
}

/** One line an operator can read: what went wrong launching a scheduled run. */
export function formatScheduleError(err: unknown): string {
  if (err instanceof GithubAuthError) {
    return 'github: the scheduler token was rejected';
  }
  if (err instanceof HeadShaResolutionError) {
    return 'github: could not resolve the current head';
  }
  return err instanceof Error ? err.message : String(err);
}

export async function runSchedulerTick(deps: SchedulerTickDeps): Promise<SchedulerTickResult> {
  const now = deps.now();
  const claimed = await deps.claim(now, deps.batchSize);
  const result: SchedulerTickResult = {
    claimed: claimed.length,
    launched: 0,
    deferred: 0,
    failed: 0,
  };

  for (const record of claimed) {
    const schedule = parseSchedule(record);
    // The instant this run was *due*, not the instant the tick got to it.
    const dueAt = record.nextRunAt;
    try {
      const job = await deps.startReview({
        userId: schedule.userId,
        token: deps.token,
        target: schedule.target,
        scheduleId: schedule.id,
      });
      await deps.completeRun(schedule.id, {
        nextRunAt: nextRunAt(schedule, dueAt, now),
        ranAt: now,
        jobId: job.id,
      });
      result.launched += 1;
      logger.info(
        { schedule_id: schedule.id, job_id: job.id, user_id: schedule.userId },
        'scheduled review launched',
      );
    } catch (err) {
      if (err instanceof JobInFlightError) {
        // The owner is at MAX_JOBS_PER_USER. That is their cap, not the
        // schedule's fault, so it costs no failure streak: put the row back
        // and pick it up again once their review is out of the way.
        await deps.releaseRun(schedule.id, now);
        result.deferred += 1;
        logger.info(
          { schedule_id: schedule.id, user_id: schedule.userId, job_id: err.activeJobId },
          'scheduled review deferred: owner already has a review in flight',
        );
        continue;
      }

      const message = formatScheduleError(err);
      const status = await deps.failRun(schedule.id, {
        message,
        nextRunAt: new Date(now.getTime() + deps.retryBackoffMin * 60_000),
        maxFailures: deps.maxFailures,
      });
      result.failed += 1;
      logger.warn(
        { err, schedule_id: schedule.id, user_id: schedule.userId, status },
        `scheduled review failed to start: ${message}`,
      );
    }
  }

  return result;
}
