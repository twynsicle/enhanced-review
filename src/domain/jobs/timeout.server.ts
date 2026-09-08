import { logger } from '../../common/logger.ts';
import * as reviewJobs from '../../db/review-jobs.ts';

/**
 * Per-job wall-clock limit (`REVIEW_TIMEOUT_MIN`). When it fires, the job is
 * marked `error` *first* and the controller aborted with reason `timeout`
 * second, so the runner's abort path knows the terminal status is already
 * written (phase-3-plan P3-D8). Returns a disarm function for the normal
 * completion path.
 */
export interface ArmTimeoutOptions {
  minutes: number;
  markErrored?: (jobId: string, message: string) => Promise<boolean>;
}

export function timeoutMessage(minutes: number): string {
  return `timeout: job exceeded ${String(minutes)} min`;
}

export function armTimeout(
  jobId: string,
  controller: AbortController,
  options: ArmTimeoutOptions,
): () => void {
  const markErrored = options.markErrored ?? reviewJobs.markErrored;
  const timer = setTimeout(() => {
    markErrored(jobId, timeoutMessage(options.minutes))
      .catch((err: unknown) => {
        logger.warn({ err, job_id: jobId }, 'failed to mark timed-out job');
      })
      .finally(() => {
        logger.warn({ job_id: jobId, minutes: options.minutes }, 'job timed out');
        controller.abort('timeout');
      });
  }, options.minutes * 60_000);
  timer.unref();
  return () => clearTimeout(timer);
}
