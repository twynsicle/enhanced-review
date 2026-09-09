/**
 * Job status vocabulary for code that ships to the browser. Mirrors the
 * Prisma `JobStatus` enum (which only `src/db` may import) and the
 * `TERMINAL_STATUSES` list in `db/review-jobs.ts`.
 */
export const JOB_STATUSES = ['pending', 'running', 'done', 'error', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}
