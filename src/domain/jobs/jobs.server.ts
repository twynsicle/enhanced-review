import * as reviewChunks from '../../db/review-chunks.ts';
import * as reviewJobs from '../../db/review-jobs.ts';
import * as reviews from '../../db/reviews.ts';
import { NarrativeReviewSchema, type NarrativeReview } from '../review/narrative.ts';
import { ReviewTargetSchema, type ReviewTarget } from '../review/target.ts';
import type { ChunkView, JobView } from './job-view.ts';

/**
 * The read side of jobs for loaders: repository rows with their JSON
 * columns parsed through the shared Zod schemas (`target`, `content`). The
 * layering rule keeps `db` below `domain`, so the parsing lives here rather
 * than in the repositories. A row that fails to parse is a bug or a bad
 * migration; the error names the job.
 */
export interface ReviewJob extends Omit<reviewJobs.ReviewJobRecord, 'target'> {
  target: ReviewTarget;
}

export interface Review {
  jobId: string;
  content: NarrativeReview;
  diffTruncated: boolean;
  createdAt: Date;
}

export function parseJob(record: reviewJobs.ReviewJobRecord): ReviewJob {
  const target = ReviewTargetSchema.safeParse(record.target);
  if (!target.success) {
    throw new Error(`review_jobs.target is invalid for job ${record.id}: ${target.error.message}`);
  }
  return { ...record, target: target.data };
}

export function parseReview(record: reviews.ReviewRecord): Review {
  const content = NarrativeReviewSchema.safeParse(record.content);
  if (!content.success) {
    throw new Error(`reviews.content is invalid for job ${record.jobId}: ${content.error.message}`);
  }
  return {
    jobId: record.jobId,
    content: content.data,
    diffTruncated: record.diffTruncated,
    createdAt: record.createdAt,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from URLs; anything that is not a UUID is "not found", not a Postgres cast error. */
export async function getJob(id: string): Promise<ReviewJob | null> {
  if (!UUID.test(id)) return null;
  const record = await reviewJobs.findJobById(id);
  return record ? parseJob(record) : null;
}

export async function listJobs(options: reviewJobs.ListJobsOptions): Promise<ReviewJob[]> {
  return (await reviewJobs.listJobs(options)).map(parseJob);
}

/** The user's jobs that turned terminal at or after `since` (the notifier's poll). */
export async function listTerminalJobsSince(userId: string, since: Date): Promise<ReviewJob[]> {
  return (await reviewJobs.listTerminalJobsSince(userId, since)).map(parseJob);
}

export async function getReview(jobId: string): Promise<Review | null> {
  const record = await reviews.findReviewByJobId(jobId);
  return record ? parseReview(record) : null;
}

/** Streamed chunks with `seq > after`, oldest first (`after = -1` → all). */
export async function listChunksAfter(jobId: string, after = -1): Promise<ChunkView[]> {
  const rows = await reviewChunks.listChunksAfter(jobId, after);
  return rows.map(({ seq, content }) => ({ seq, content }));
}

/** Creation timestamps of the last `days` days, for the activity sparkline. */
export function listRecentActivity(days = 14, now = new Date()): Promise<Date[]> {
  return reviewJobs.listJobCreatedAtSince(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** Browser-facing shape: ISO timestamps instead of `Date`s (phase-4-plan §2). */
export function toJobView(job: ReviewJob): JobView {
  return {
    id: job.id,
    userId: job.userId,
    githubLogin: job.githubLogin,
    target: job.target,
    status: job.status,
    headSha: job.headSha,
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    cancelledAt: iso(job.cancelledAt),
    errorMessage: job.errorMessage,
    riskScore: job.riskScore,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
