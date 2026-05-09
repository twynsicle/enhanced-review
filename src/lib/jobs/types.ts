import type { ReviewTarget } from '@enhanced-review/github-client';
import type { NarrativeReview } from '@enhanced-review/review-types';
import type { reviewChunks, reviewJobs, reviews } from '@/lib/db/schema';

/**
 * `review_jobs` row shape as the rest of the app reads it. Field names are
 * snake_case for historical reasons (matched PB's column names) — Drizzle
 * rows come back camelCase, so reads go through `toJobRow` below before
 * being handed to consumers.
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
  risk_score?: number | null;
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

type DrizzleJob = typeof reviewJobs.$inferSelect;
type DrizzleChunk = typeof reviewChunks.$inferSelect;
type DrizzleReview = typeof reviews.$inferSelect;

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function toJobRow(row: DrizzleJob): ReviewJobRow {
  return {
    id: row.id,
    user: row.userId,
    github_login: row.githubLogin,
    target: row.target,
    status: row.status,
    head_sha: row.headSha ?? '',
    created: row.createdAt.toISOString(),
    updated: row.updatedAt.toISOString(),
    started_at: isoOrNull(row.startedAt),
    completed_at: isoOrNull(row.completedAt),
    cancelled_at: isoOrNull(row.cancelledAt),
    error_message: row.errorMessage,
    risk_score: row.riskScore,
  };
}

export function toChunkRow(row: DrizzleChunk): ReviewChunkRow {
  return {
    id: row.id,
    job: row.jobId,
    seq: row.seq,
    content: row.content,
    created: row.createdAt.toISOString(),
  };
}

export function toReviewRow(row: DrizzleReview): ReviewRow {
  return {
    id: row.id,
    job: row.jobId,
    content: row.content,
    diff_truncated: row.diffTruncated,
    created: row.createdAt.toISOString(),
  };
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
