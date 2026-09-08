import * as reviewJobs from '../../db/review-jobs.ts';
import * as reviews from '../../db/reviews.ts';
import { NarrativeReviewSchema, type NarrativeReview } from '../review/narrative.ts';
import { ReviewTargetSchema, type ReviewTarget } from '../review/target.ts';

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

export async function getJob(id: string): Promise<ReviewJob | null> {
  const record = await reviewJobs.findJobById(id);
  return record ? parseJob(record) : null;
}

export async function listJobs(options: reviewJobs.ListJobsOptions): Promise<ReviewJob[]> {
  return (await reviewJobs.listJobs(options)).map(parseJob);
}

export async function getReview(jobId: string): Promise<Review | null> {
  const record = await reviews.findReviewByJobId(jobId);
  return record ? parseReview(record) : null;
}
