import 'server-only';
import { detectLanguage } from '@/lib/narrative/language-map';

/**
 * View-time GitHub data layer for the review reader UI.
 *
 * Diff context, PR metadata, and current head SHAs are deliberately
 * re-fetched from GitHub on every render rather than persisted. These
 * helpers are the single ingress point.
 *
 * All helpers run server-only (see `'server-only'` import) and use plain
 * `fetch` so Next.js's data-cache can amortise refresh hits via
 * `next: { revalidate }`. Token authorisation header is part of the cache
 * key, so workspace members cannot accidentally read each other's
 * cached responses.
 */

const GITHUB_API = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';
const REVALIDATE_SECONDS = 30;
const MAX_CONTENT_BYTES = 1_000_000;

type ViewTimeErrorKind =
  | 'no-access' // 403 — token valid, but lacks permission
  | 'not-found' // 404 — resource (or path-at-ref) doesn't exist
  | 'too-large' // file blob > 1MB; contents API truncates these to empty
  | 'rate-limited' // 403 / 429 with rate-limit headers
  | 'unauthorized' // 401 — token rejected; caller redirects to /relink
  | 'unknown';

export interface ViewTimeError {
  kind: ViewTimeErrorKind;
  status?: number;
  message?: string;
}

export type ViewTimeResult<T> = { ok: true; data: T } | { ok: false; error: ViewTimeError };

export interface FileAtRef {
  content: string;
  language: string;
  lineCount: number;
}

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

interface GithubFileContents {
  type?: string;
  encoding?: string;
  size?: number;
  content?: string;
}

interface GithubPullResponse {
  title: string;
  body: string | null;
  user: { login: string; avatar_url: string } | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  changed_files: number;
  additions: number;
  deletions: number;
  html_url: string;
}

interface GithubBranchResponse {
  name: string;
  commit: { sha: string; commit?: { message?: string } };
}

interface GithubCompareResponse {
  total_commits: number;
}

interface GithubReviewResponse {
  user: { login: string; avatar_url: string } | null;
  state: string;
  submitted_at: string | null;
}

interface GithubRequestedReviewersResponse {
  users: { login: string; avatar_url: string }[];
}

async function callGithub<T>(path: string, token: string): Promise<ViewTimeResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      method: 'GET',
      headers: {
        Accept: ACCEPT,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (cause) {
    return {
      ok: false,
      error: { kind: 'unknown', message: cause instanceof Error ? cause.message : 'fetch failed' },
    };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (cause) {
      return {
        ok: false,
        error: { kind: 'unknown', message: cause instanceof Error ? cause.message : 'bad json' },
      };
    }
  }

  return { ok: false, error: classifyError(res) };
}

function classifyError(res: Response): ViewTimeError {
  if (res.status === 401) return { kind: 'unauthorized', status: 401 };
  if (res.status === 404) return { kind: 'not-found', status: 404 };
  if (res.status === 429) return { kind: 'rate-limited', status: 429 };
  if (res.status === 403) {
    // GitHub uses 403 for both rate-limit and permission denied. The
    // remaining-rate header disambiguates.
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') return { kind: 'rate-limited', status: 403 };
    return { kind: 'no-access', status: 403 };
  }
  return { kind: 'unknown', status: res.status };
}

function decodeBase64(content: string): string {
  // GitHub returns base64 with newlines every 60 chars; Buffer/atob handles
  // both. Use Buffer in Node (this module is server-only).
  const cleaned = content.replace(/\n/g, '');
  return Buffer.from(cleaned, 'base64').toString('utf8');
}

function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

/**
 * Fetch a single file blob at a specific ref. Returns `not-found` for
 * paths that legitimately don't exist on that side of a diff (e.g. an
 * added file at the base ref) — callers treat that as `content: ''`.
 *
 * Files larger than ~1MB hit GitHub's contents API truncation and return
 * `too-large`; for those Phase 6 just renders a "file too large to
 * preview" body.
 */
export async function getFileAtRef(args: {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  token: string;
}): Promise<ViewTimeResult<FileAtRef>> {
  const { owner, repo, path, ref, token } = args;
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  const result = await callGithub<GithubFileContents>(url, token);
  if (!result.ok) return result;

  const payload = result.data;
  if (payload.type !== 'file') {
    return { ok: false, error: { kind: 'not-found' } };
  }
  if (typeof payload.size === 'number' && payload.size > MAX_CONTENT_BYTES) {
    return { ok: false, error: { kind: 'too-large' } };
  }
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    return { ok: false, error: { kind: 'too-large' } };
  }

  const content = decodeBase64(payload.content);
  return {
    ok: true,
    data: {
      content,
      language: detectLanguage(path),
      lineCount: countLines(content),
    },
  };
}

export async function getPullMetadata(args: {
  owner: string;
  repo: string;
  number: number;
  token: string;
}): Promise<ViewTimeResult<PullMetadata>> {
  const { owner, repo, number, token } = args;
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${String(number)}`;
  const result = await callGithub<GithubPullResponse>(url, token);
  if (!result.ok) return result;

  const data = result.data;
  return {
    ok: true,
    data: {
      title: data.title,
      authorLogin: data.user?.login ?? null,
      authorAvatarUrl: data.user?.avatar_url ?? null,
      body: data.body,
      baseRefName: data.base.ref,
      headRefName: data.head.ref,
      baseSha: data.base.sha,
      headSha: data.head.sha,
      changedFiles: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      htmlUrl: data.html_url,
    },
  };
}

export async function getBranchHead(args: {
  owner: string;
  repo: string;
  ref: string;
  token: string;
}): Promise<ViewTimeResult<BranchHead>> {
  const { owner, repo, ref, token } = args;
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(ref)}`;
  const result = await callGithub<GithubBranchResponse>(url, token);
  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      sha: result.data.commit.sha,
      commitMessage: result.data.commit.commit?.message ?? '',
    },
  };
}

/**
 * Reviewers on a PR — submitted reviews collapsed to one row per user
 * (latest review wins) plus any still-pending requested reviewers. Used
 * by the SummaryCard's PEOPLE column.
 */
export async function getPullReviewers(args: {
  owner: string;
  repo: string;
  number: number;
  token: string;
}): Promise<ViewTimeResult<PullReviewer[]>> {
  const { owner, repo, number, token } = args;
  const ownerEnc = encodeURIComponent(owner);
  const repoEnc = encodeURIComponent(repo);
  const numberStr = String(number);

  const reviewsResult = await callGithub<GithubReviewResponse[]>(
    `/repos/${ownerEnc}/${repoEnc}/pulls/${numberStr}/reviews`,
    token,
  );
  if (!reviewsResult.ok) return reviewsResult;

  const latestByLogin = new Map<string, PullReviewer>();
  for (const review of reviewsResult.data) {
    const login = review.user?.login;
    if (!login) continue;
    const state = mapReviewState(review.state);
    if (state === null) continue;
    const submittedAt = review.submitted_at;
    const existing = latestByLogin.get(login);
    if (existing && existing.submittedAt && submittedAt && submittedAt <= existing.submittedAt) {
      continue;
    }
    latestByLogin.set(login, {
      login,
      avatarUrl: review.user?.avatar_url ?? null,
      state,
      submittedAt,
    });
  }

  const requestedResult = await callGithub<GithubRequestedReviewersResponse>(
    `/repos/${ownerEnc}/${repoEnc}/pulls/${numberStr}/requested_reviewers`,
    token,
  );
  if (requestedResult.ok) {
    for (const user of requestedResult.data.users) {
      if (latestByLogin.has(user.login)) continue;
      latestByLogin.set(user.login, {
        login: user.login,
        avatarUrl: user.avatar_url,
        state: 'pending',
        submittedAt: null,
      });
    }
  }

  return { ok: true, data: Array.from(latestByLogin.values()) };
}

function mapReviewState(raw: string): ReviewerState | null {
  switch (raw.toUpperCase()) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes_requested';
    case 'COMMENTED':
      return 'commented';
    default:
      return null;
  }
}

/**
 * How many commits are between `base` and `head`. Used by the staleness
 * banner to display "N new commits since this review". Returns 0 when
 * the SHAs are identical.
 */
export async function getCommitsAhead(args: {
  owner: string;
  repo: string;
  base: string;
  head: string;
  token: string;
}): Promise<ViewTimeResult<CommitsAhead>> {
  const { owner, repo, base, head, token } = args;
  if (base === head) return { ok: true, data: { count: 0 } };

  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const result = await callGithub<GithubCompareResponse>(url, token);
  if (!result.ok) return result;

  return { ok: true, data: { count: result.data.total_commits } };
}
