import 'server-only';
import type PocketBase from 'pocketbase';

/**
 * Per-user concurrency cap shared by `POST /api/jobs` and
 * `POST /api/jobs/[id]/rerun`. We allow at most `MAX_JOBS_PER_USER`
 * pending-or-running jobs per user; submitting another while one is in
 * flight returns a 409 the UI surfaces as a "you already have a review
 * running — view it" prompt linking to that in-flight job.
 *
 * Race window: count + insert isn't atomic. For closed beta (low rate,
 * one user at a time clicking) this is fine.
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
 * they're under the cap. Reads via the supplied PB client — pass the
 * superuser admin client (`pbAdmin()`) to keep the count consistent
 * regardless of collection rule state.
 */
export async function findUserInFlightJob(
  pb: PocketBase,
  userId: string,
): Promise<ActiveJob | null> {
  const cap = maxJobsPerUser();
  const result = await pb.collection('review_jobs').getList(1, cap, {
    filter: `user = "${userId}" && (status = "pending" || status = "running")`,
    sort: '-created',
    fields: 'id,status',
  });
  const rows = result.items as unknown as ActiveJob[];
  if (rows.length < cap) return null;
  return rows[0] ?? null;
}
