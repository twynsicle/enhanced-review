import { logger } from '../../common/logger.ts';
import * as reviewJobs from '../../db/review-jobs.ts';
import { registry as defaultRegistry, type JobRegistry } from './registry.server.ts';

/**
 * Owner-only cancellation. The conditional update in the repository is the
 * whole authorisation check; `not-cancellable` deliberately covers both
 * "not yours" and "already finished" so the response never leaks ownership
 * (the PocketBase-era 409 did the same). The status is written *before* the
 * runner is signalled so its abort path knows not to write one.
 */
export type CancelOutcome = 'cancelled' | 'not-cancellable';

export interface CancelJobDeps {
  cancel: typeof reviewJobs.cancelJob;
  registry: JobRegistry;
}

export async function cancelJob(
  input: { jobId: string; userId: string },
  deps: CancelJobDeps = { cancel: reviewJobs.cancelJob, registry: defaultRegistry },
): Promise<CancelOutcome> {
  const written = await deps.cancel(input.jobId, input.userId);
  if (!written) return 'not-cancellable';
  const running = deps.registry.signal(input.jobId, 'cancel');
  logger.info({ job_id: input.jobId, user_id: input.userId, running }, 'job cancelled');
  return 'cancelled';
}
