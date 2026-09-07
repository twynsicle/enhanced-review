/**
 * Repo summary as surfaced in the picker list. Mirrors a subset of GitHub's
 * REST `/user/repos` payload — only the fields the UI actually consumes.
 */
export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  htmlUrl: string;
}

/**
 * Open pull request summary, sorted by GitHub's default (newest first).
 * `headSha` / `baseSha` are captured here so the worker can pin a review
 * to an exact commit pair without a second round-trip.
 */
export interface PullSummary {
  number: number;
  title: string;
  state: 'open';
  draft: boolean;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Branch with its tip commit, returned from the GraphQL query that orders
 * by committed date. Only branches whose tip is within the active window
 * are returned (see {@link listRecentBranches}).
 */
export interface BranchSummary {
  ref: string;
  headSha: string;
  headCommitDate: string;
  headCommitMessage: string;
}

/**
 * The shape the picker writes into the URL once a target is selected.
 * Phase 3 persists this verbatim into `review_jobs.target`.
 */
export type ReviewTarget =
  | {
      kind: 'pr';
      owner: string;
      repo: string;
      number: number;
      headSha: string;
      baseSha: string;
      title: string;
    }
  | {
      kind: 'branch';
      owner: string;
      repo: string;
      ref: string;
      headSha: string;
      baseRef: string;
      baseSha: string;
    };
