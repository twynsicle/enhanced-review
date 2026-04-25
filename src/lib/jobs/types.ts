import type { ReviewTarget } from '@enhanced-review/github-client';
import type { NarrativeReview } from '@enhanced-review/review-types';

/**
 * `review_jobs` row shape as we read it from the user-scoped client.
 * Hand-written instead of using Supabase-generated types — small, stable,
 * and avoids pulling in a code-gen dependency for v1.
 */
export interface ReviewJobRow {
  id: string;
  user_id: string;
  github_login: string;
  target: ReviewTarget;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  head_sha: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  error_message: string | null;
  worker_id: string | null;
}

export interface ReviewChunkRow {
  id: number;
  job_id: string;
  seq: number;
  content: string;
  created_at: string;
}

export interface ReviewRow {
  id: string;
  job_id: string;
  content: NarrativeReview;
  created_at: string;
}

/**
 * Renders a `target` jsonb as a single human-readable line for the
 * history table and the /jobs/:id header.
 */
export function describeTarget(target: ReviewTarget): string {
  if (target.kind === 'pr') {
    return `${target.owner}/${target.repo} PR #${target.number} — ${target.title}`;
  }
  return `${target.owner}/${target.repo} branch:${target.ref} → ${target.baseRef}`;
}
