import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';

/**
 * Per-user concurrency cap shared by `POST /api/jobs` and
 * `POST /api/jobs/[id]/rerun`. We allow at most `MAX_JOBS_PER_USER`
 * pending-or-running jobs per user; submitting another while one is in
 * flight returns a 409 the UI surfaces as a "you already have a review
 * running — view it" prompt linking to that in-flight job.
 *
 * Race window: count + insert isn't atomic outside a transaction. The
 * jobs route inlines the check inside `db.transaction(...)` to close
 * that race; this exposed helper is for non-transactional callers
 * (`/api/jobs/[id]/rerun`) where the race is acceptable for closed beta.
 */

export const DEFAULT_MAX_JOBS_PER_USER = 1;

export function maxJobsPerUser(): number {
  const raw = process.env.MAX_JOBS_PER_USER;
  if (!raw) return DEFAULT_MAX_JOBS_PER_USER;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_JOBS_PER_USER;
  }
  return Math.floor(parsed);
}

export interface ActiveJob {
  id: string;
  status: 'pending' | 'running';
}

/**
 * Returns the user's most recently created in-flight job, or null when
 * they're under the cap. Reads via Drizzle.
 */
export async function findUserInFlightJob(userId: string): Promise<ActiveJob | null> {
  const cap = maxJobsPerUser();
  const rows = await db
    .select({ id: reviewJobs.id, status: reviewJobs.status })
    .from(reviewJobs)
    .where(
      and(
        eq(reviewJobs.userId, userId),
        inArray(reviewJobs.status, ['pending', 'running']),
      ),
    )
    .orderBy(desc(reviewJobs.createdAt))
    .limit(cap);
  if (rows.length < cap) return null;
  const top = rows[0];
  if (!top) return null;
  return { id: top.id, status: top.status as 'pending' | 'running' };
}

/**
 * Count active jobs for a user. Used inside the transactional
 * concurrency-check in `POST /api/jobs`.
 */
export async function countActiveForUser(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewJobs)
    .where(
      and(
        eq(reviewJobs.userId, userId),
        inArray(reviewJobs.status, ['pending', 'running']),
      ),
    );
  return n;
}
