import { z } from 'zod';

/**
 * What the report's summary header says about where a review came from:
 * repository, PR, refs, author and the author's own description, as `er`
 * gathered them from git and `gh`.
 *
 * `title` is the fallback for a review whose `prTitle` is empty; `stats` is the
 * fallback for one with no `files` list. The two commits are what the reader
 * keys a reader's progress on, so rendering the same range again keeps it.
 * Everything past them is nullable because a review of staged changes has no
 * PR, and a branch has no description.
 */
export const ReviewMetaSchema = z.object({
  /** Display label, `owner/name` for a GitHub repository. */
  repo: z.string(),
  title: z.string(),
  baseSha: z.string().min(1),
  headSha: z.string().min(1),
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
