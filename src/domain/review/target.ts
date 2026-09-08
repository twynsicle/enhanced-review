import { z } from 'zod';

/**
 * What a review is about: a pull request or a branch pair, pinned to SHAs.
 * The picker builds it in the browser, the create action validates it, and
 * `review_jobs.target` stores it verbatim; the repository parses it back
 * through the same schema. Shared by server and browser.
 *
 * `headSha` / `baseSha` are accepted from the client, but the job service
 * re-resolves them against GitHub before insert, so a stale value is harmless.
 */
export const ReviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pr'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    headSha: z.string().min(1),
    baseSha: z.string().min(1),
    title: z.string(),
  }),
  z.object({
    kind: z.literal('branch'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1),
    headSha: z.string().min(1),
    baseRef: z.string().min(1),
    baseSha: z.string().min(1),
  }),
]);

export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;
export type PullReviewTarget = Extract<ReviewTarget, { kind: 'pr' }>;
export type BranchReviewTarget = Extract<ReviewTarget, { kind: 'branch' }>;

/** One human-readable line for the history table and the `/jobs/:id` header. */
export function describeTarget(target: ReviewTarget): string {
  if (target.kind === 'pr') {
    return `${target.owner}/${target.repo} PR #${String(target.number)} — ${target.title}`;
  }
  return `${target.owner}/${target.repo} branch:${target.ref} → ${target.baseRef}`;
}
