import type { ReviewTarget } from '../review/target.ts';
import type { JobStatus } from './status.ts';

/**
 * The browser-facing shape of a job: what loaders and the polling resource
 * route hand to components. Timestamps are ISO strings so the same type
 * serves loader data, `useFetcher` responses and list rows without `Date`
 * round-trip surprises. Built by `toJobView` in `jobs.server.ts`.
 */
export interface JobView {
  id: string;
  userId: string;
  githubLogin: string;
  target: ReviewTarget;
  status: JobStatus;
  headSha: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  errorMessage: string | null;
  riskScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChunkView {
  seq: number;
  content: string;
}

/** `/history` and the Recent card link done jobs to the reader, the rest to the live view. */
export function jobHref(job: Pick<JobView, 'id' | 'status'>): string {
  return job.status === 'done' ? `/reviews/${job.id}` : `/jobs/${job.id}`;
}
