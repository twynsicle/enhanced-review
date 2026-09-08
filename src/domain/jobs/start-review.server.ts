import { logger } from '../../common/logger.ts';
import { env } from '../../config/env.ts';
import * as reviewJobs from '../../db/review-jobs.ts';
import { createOctokit, type GithubClient } from '../github/client.server.ts';
import { resolveFreshReviewTarget } from '../github/resolve-target.server.ts';
import {
  defaultRunJobDeps,
  runJob as runReviewJob,
  type RunJobDeps,
  type RunJobInput,
  type RunJobOutcome,
} from '../review/run.server.ts';
import { ReviewTargetSchema, type ReviewTarget } from '../review/target.ts';
import { HeadShaResolutionError, JobInFlightError, JobNotFoundError } from './errors.ts';
import { registry as defaultRegistry, type JobRegistry } from './registry.server.ts';
import { armTimeout as defaultArmTimeout } from './timeout.server.ts';

/**
 * Creating a review, from the create action and from rerun:
 *
 *   in-flight check (MAX_JOBS_PER_USER)  → JobInFlightError(activeJobId)
 *   re-pin the target against GitHub     → GithubAuthError | HeadShaResolutionError
 *   insert `pending`                     → { id }
 *   launch: register controller, arm timeout, run fire-and-forget
 *
 * A rerun mirrors the source job's target but is owned by the viewer and
 * pinned to the *current* head. The GitHub token arrives from the caller's
 * cookie and goes no further than the runner.
 */
export interface StartReviewInput {
  userId: string;
  token: string;
  target: ReviewTarget;
}

export interface RerunJobInput {
  userId: string;
  token: string;
  sourceJobId: string;
}

export interface LaunchInput {
  jobId: string;
  token: string;
  target: ReviewTarget;
  headSha: string;
}

export interface LaunchDeps {
  registry: JobRegistry;
  runJob: (input: RunJobInput, deps: RunJobDeps) => Promise<RunJobOutcome>;
  runDeps: () => RunJobDeps;
  armTimeout: typeof defaultArmTimeout;
  markErrored: (jobId: string, message: string) => Promise<boolean>;
  timeoutMinutes: number;
  model: string;
}

export interface StartReviewDeps {
  findInFlightJob: typeof reviewJobs.findInFlightJob;
  createJob: typeof reviewJobs.createJob;
  findJobById: typeof reviewJobs.findJobById;
  octokitFor: (token: string) => GithubClient;
  resolveTarget: typeof resolveFreshReviewTarget;
  launch: (input: LaunchInput) => void;
  maxJobsPerUser: number;
}

export function defaultLaunchDeps(): LaunchDeps {
  return {
    registry: defaultRegistry,
    runJob: runReviewJob,
    runDeps: defaultRunJobDeps,
    armTimeout: defaultArmTimeout,
    markErrored: reviewJobs.markErrored,
    timeoutMinutes: env.REVIEW_TIMEOUT_MIN,
    model: env.REVIEW_MODEL,
  };
}

export function defaultStartReviewDeps(): StartReviewDeps {
  return {
    findInFlightJob: reviewJobs.findInFlightJob,
    createJob: reviewJobs.createJob,
    findJobById: reviewJobs.findJobById,
    octokitFor: createOctokit,
    resolveTarget: resolveFreshReviewTarget,
    launch: (input) => {
      void launchJob(input, defaultLaunchDeps());
    },
    maxJobsPerUser: env.MAX_JOBS_PER_USER,
  };
}

/**
 * Fire the runner for a `pending` job. Resolves with the runner's outcome
 * once it has finished; callers that don't care ignore the promise. A runner
 * that rejects (a bug, not a review failure) still leaves the job terminal.
 */
export function launchJob(input: LaunchInput, deps: LaunchDeps): Promise<RunJobOutcome> {
  const { jobId } = input;
  const controller = new AbortController();
  deps.registry.register(jobId, controller);
  const disarm = deps.armTimeout(jobId, controller, { minutes: deps.timeoutMinutes });

  const done = deps
    .runJob(
      {
        jobId,
        token: input.token,
        target: input.target,
        headSha: input.headSha,
        model: deps.model,
        signal: controller.signal,
      },
      deps.runDeps(),
    )
    .catch(async (err: unknown): Promise<RunJobOutcome> => {
      logger.error({ err, job_id: jobId }, 'runJob rejected unexpectedly');
      await deps
        .markErrored(jobId, `runner crashed: ${err instanceof Error ? err.message : String(err)}`)
        .catch(() => undefined);
      return 'errored';
    })
    .finally(() => {
      disarm();
      deps.registry.unregister(jobId);
    });
  deps.registry.track(jobId, done);
  return done;
}

async function createAndLaunch(
  userId: string,
  token: string,
  target: ReviewTarget,
  deps: StartReviewDeps,
): Promise<{ id: string }> {
  const inFlight = await deps.findInFlightJob(userId, deps.maxJobsPerUser);
  if (inFlight) throw new JobInFlightError(inFlight.id);

  let fresh: { target: ReviewTarget; headSha: string };
  try {
    fresh = await deps.resolveTarget(deps.octokitFor(token), target);
  } catch (err) {
    if (err instanceof Error && err.name === 'GithubAuthError') throw err;
    throw new HeadShaResolutionError(err);
  }

  const job = await deps.createJob({ userId, target: fresh.target, headSha: fresh.headSha });
  logger.info({ job_id: job.id, user_id: userId, target: target.kind }, 'job created');
  deps.launch({ jobId: job.id, token, target: fresh.target, headSha: fresh.headSha });
  return { id: job.id };
}

export function startReview(
  input: StartReviewInput,
  deps: StartReviewDeps = defaultStartReviewDeps(),
): Promise<{ id: string }> {
  return createAndLaunch(input.userId, input.token, input.target, deps);
}

export async function rerunJob(
  input: RerunJobInput,
  deps: StartReviewDeps = defaultStartReviewDeps(),
): Promise<{ id: string }> {
  const source = await deps.findJobById(input.sourceJobId);
  if (!source) throw new JobNotFoundError(input.sourceJobId);
  const target = ReviewTargetSchema.parse(source.target);
  return createAndLaunch(input.userId, input.token, target, deps);
}
