import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-user concurrency cap shared by `POST /api/jobs` and
 * `POST /api/jobs/[id]/rerun`. We allow at most `MAX_JOBS_PER_USER`
 * pending-or-running jobs per user; submitting another while one is in
 * flight returns a 409 the UI surfaces as a "you already have a review
 * running — view it" prompt linking to that in-flight job.
 *
 * Race window: count + insert isn't atomic. For closed beta (low rate,
 * one user at a time clicking) this is fine; under load we'd lift the
 * check into the `create_review_job_with_token` RPC.
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
 * they're under the cap. Reads via the supplied client — pass the
 * service-role admin client so the count isn't hidden by RLS.
 */
export async function findUserInFlightJob(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveJob | null> {
  const cap = maxJobsPerUser();
  const { data, error } = await supabase
    .from('review_jobs')
    .select('id,status')
    .eq('user_id', userId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(cap);

  if (error) {
    throw new Error(`findUserInFlightJob failed: ${error.message}`);
  }
  const rows = (data ?? []) as ActiveJob[];
  if (rows.length < cap) return null;
  return rows[0] ?? null;
}
