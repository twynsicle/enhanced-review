/**
 * Shapes the GitHub domain hands to the web layer. Browser-safe (no Octokit
 * here) so components and route data can share them.
 */

/** Repo as listed in the picker: a subset of REST `/user/repos`. */
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
 * Open pull request in the picker. `headSha` / `baseSha` are captured so a
 * `ReviewTarget` can be built without a second round-trip.
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

/** Branch with its tip commit; only branches inside the recent window are listed. */
export interface BranchSummary {
  ref: string;
  headSha: string;
  headCommitDate: string;
  headCommitMessage: string;
}

export interface RecentBranchesResult {
  defaultBranch: string;
  defaultBranchSha: string;
  branches: BranchSummary[];
  /** The listing reads at most this many branches (alphabetically) before filtering. */
  truncatedToCount: number;
}

/**
 * View-time reads (reader page, live metadata, file blobs) return a result
 * instead of throwing so the page can degrade per section.
 */
export type GithubErrorKind =
  | 'no-access' // 403 — token valid, but lacks permission
  | 'not-found' // 404 — resource (or path-at-ref) does not exist
  | 'too-large' // file blob > 1 MB; the contents API truncates these
  | 'rate-limited' // 403 with x-ratelimit-remaining: 0, or 429
  | 'unauthorized' // 401 — token rejected; caller redirects to /relink
  | 'unknown';

export interface GithubError {
  kind: GithubErrorKind;
  status?: number;
  message?: string;
}

export type GithubResult<T> = { ok: true; data: T } | { ok: false; error: GithubError };

export interface FileAtRef {
  content: string;
  language: string;
  lineCount: number;
}

/** PR header data: the runner's prompt input and the reader's SummaryCard. */
export interface PullMetadata {
  title: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  body: string | null;
  baseRefName: string;
  headRefName: string;
  baseSha: string;
  headSha: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  htmlUrl: string;
}

export interface BranchHead {
  sha: string;
  commitMessage: string;
}

export type ReviewerState = 'approved' | 'changes_requested' | 'commented' | 'pending';

export interface PullReviewer {
  login: string;
  avatarUrl: string | null;
  state: ReviewerState;
  submittedAt: string | null;
}

export interface CommitsAhead {
  count: number;
}
