/**
 * Worker-internal shapes. Mirrors the relevant subset of `review_jobs`
 * — re-using a hand-written type rather than depending on a Supabase
 * generated client for portability across the dual-mode runtime.
 */

export interface ClaimedJob {
  id: string;
  user_id: string;
  github_login: string;
  target: unknown;
  head_sha: string;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';
