import type { ReviewTarget } from '@enhanced-review/github-client';
import type { NarrativeReview } from '@enhanced-review/review-types';

/**
 * `review_jobs` row shape as we read it from PocketBase. Field names
 * follow PB conventions: relation columns are the related record id
 * (`user`, `job`), autodate columns are `created`/`updated`.
 */
export interface ReviewJobRow {
  id: string;
  user: string;
  github_login: string;
  target: ReviewTarget;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  head_sha: string;
  created: string;
  updated: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  error_message: string | null;
}

export interface ReviewChunkRow {
  id: string;
  job: string;
  seq: number;
  content: string;
  created: string;
}

export interface ReviewRow {
  id: string;
  job: string;
  content: NarrativeReview;
  diff_truncated: boolean;
  created: string;
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
