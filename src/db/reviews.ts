import { prisma } from './client.ts';

/**
 * `reviews` repository — read side only. The row is created inside
 * `finalizeDone` in `review-jobs.ts` so it lands in the same transaction as
 * the `done` flip. `content` is a `NarrativeReview`; `domain/jobs` parses it.
 */
export interface ReviewRecord {
  id: string;
  jobId: string;
  content: unknown;
  diffTruncated: boolean;
  createdAt: Date;
}

export function findReviewByJobId(jobId: string): Promise<ReviewRecord | null> {
  return prisma.review.findUnique({
    where: { jobId },
    select: { id: true, jobId: true, content: true, diffTruncated: true, createdAt: true },
  });
}
