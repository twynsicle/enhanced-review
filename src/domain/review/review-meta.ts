import { z } from 'zod';
import type { PullMetadata } from '../github/types.ts';
import type { ReviewTarget } from './target.ts';

/**
 * What the reader's summary header says about where a review came from:
 * repository, PR, refs, author and the author's own description. The reader
 * takes this instead of a `ReviewTarget` + GitHub `PullMetadata`, so the same
 * header renders for a hosted job and for a review generated on a laptop.
 * Shared by server and browser.
 *
 * `title` is the fallback for a review whose `prTitle` is empty; `stats` is the
 * fallback for one with no `files` list. Everything past `repo` and `title` is
 * optional because a local review of staged changes has no PR, and a hosted
 * one loses its PR data when the viewer cannot reach GitHub.
 */
export const ReviewMetaSchema = z.object({
  /** Display label, `owner/name` for a GitHub repository. */
  repo: z.string(),
  title: z.string(),
  prNumber: z.number().int().positive().nullable(),
  baseRefName: z.string().nullable(),
  headRefName: z.string().nullable(),
  authorLogin: z.string().nullable(),
  /** The PR description, markdown. */
  description: z.string().nullable(),
  stats: z
    .object({
      changedFiles: z.number().int(),
      additions: z.number().int(),
      deletions: z.number().int(),
    })
    .nullable(),
});
export type ReviewMeta = z.infer<typeof ReviewMetaSchema>;

/**
 * The hosted reader's header: `pullMetadata` when GitHub answered at view
 * time, otherwise what the job stored when it was submitted. `jobAuthor` is
 * the login of whoever ran the review, the byline of last resort.
 */
export function reviewMetaFromJob(
  target: ReviewTarget,
  pullMetadata: PullMetadata | null,
  jobAuthor: string,
): ReviewMeta {
  const isBranch = target.kind === 'branch';
  return {
    repo: `${target.owner}/${target.repo}`,
    title: pullMetadata?.title || (target.kind === 'pr' ? target.title : target.ref),
    prNumber: target.kind === 'pr' ? target.number : null,
    baseRefName: pullMetadata?.baseRefName ?? (isBranch ? target.baseRef : null),
    headRefName: pullMetadata?.headRefName ?? (isBranch ? target.ref : null),
    authorLogin: pullMetadata?.authorLogin ?? jobAuthor,
    description: pullMetadata?.body ?? null,
    stats: pullMetadata
      ? {
          changedFiles: pullMetadata.changedFiles,
          additions: pullMetadata.additions,
          deletions: pullMetadata.deletions,
        }
      : null,
  };
}
