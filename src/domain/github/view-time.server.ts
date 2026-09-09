import { z } from 'zod';
import { detectLanguage } from '../review/language-map.ts';
import { type GithubClient, toResult } from './client.server.ts';
import type {
  BranchHead,
  CommitsAhead,
  FileAtRef,
  GithubResult,
  PullReviewer,
  ReviewerState,
} from './types.ts';

/**
 * View-time GitHub reads for the reader: file blobs for inline diffs, branch
 * heads and commit counts for the staleness banner, reviewers for the people
 * card. Deliberately re-fetched on every render rather than persisted.
 * Everything returns a `GithubResult` so the page degrades per section.
 */
const MAX_CONTENT_BYTES = 1_000_000;

const FileContentsSchema = z.object({
  type: z.string(),
  encoding: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
});

function decodeBase64(content: string): string {
  // GitHub wraps base64 every 60 chars.
  return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
}

function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

/**
 * One file blob at a ref. `not-found` for a path that legitimately does not
 * exist on that side of a diff (an added file at the base ref); callers treat
 * that as empty content. Blobs over ~1 MB come back `too-large`.
 */
export async function getFileAtRef(
  octokit: GithubClient,
  args: { owner: string; repo: string; path: string; ref: string },
): Promise<GithubResult<FileAtRef>> {
  const result = await toResult(() =>
    octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      ref: args.ref,
    }),
  );
  if (!result.ok) return result;

  // The route returns a directory listing (array), a symlink, a submodule or a file.
  const parsed = FileContentsSchema.safeParse(result.data.data);
  if (!parsed.success || parsed.data.type !== 'file') {
    return { ok: false, error: { kind: 'not-found' } };
  }
  const payload = parsed.data;
  if (typeof payload.size === 'number' && payload.size > MAX_CONTENT_BYTES) {
    return { ok: false, error: { kind: 'too-large' } };
  }
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    return { ok: false, error: { kind: 'too-large' } };
  }

  const content = decodeBase64(payload.content);
  return {
    ok: true,
    data: { content, language: detectLanguage(args.path), lineCount: countLines(content) },
  };
}

export function getBranchHead(
  octokit: GithubClient,
  args: { owner: string; repo: string; ref: string },
): Promise<GithubResult<BranchHead>> {
  return toResult(async () => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner: args.owner,
      repo: args.repo,
      branch: args.ref,
    });
    return { sha: data.commit.sha, commitMessage: data.commit.commit.message };
  });
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
 * Reviewers on a PR: submitted reviews collapsed to one row per user (latest
 * wins) plus still-pending requested reviewers. A failure on the
 * requested-reviewers call keeps the submitted ones.
 */
export async function getPullReviewers(
  octokit: GithubClient,
  args: { owner: string; repo: string; number: number },
): Promise<GithubResult<PullReviewer[]>> {
  const reviews = await toResult(() =>
    octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner: args.owner,
      repo: args.repo,
      pull_number: args.number,
      per_page: 100,
    }),
  );
  if (!reviews.ok) return reviews;

  const latestByLogin = new Map<string, PullReviewer>();
  for (const review of reviews.data.data) {
    const login = review.user?.login;
    if (!login) continue;
    const state = mapReviewState(review.state);
    if (state === null) continue;
    const submittedAt = review.submitted_at ?? null;
    const existing = latestByLogin.get(login);
    if (existing?.submittedAt && submittedAt && submittedAt <= existing.submittedAt) continue;
    latestByLogin.set(login, {
      login,
      avatarUrl: review.user?.avatar_url ?? null,
      state,
      submittedAt,
    });
  }

  const requested = await toResult(() =>
    octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
      owner: args.owner,
      repo: args.repo,
      pull_number: args.number,
    }),
  );
  if (requested.ok) {
    for (const user of requested.data.data.users) {
      if (latestByLogin.has(user.login)) continue;
      latestByLogin.set(user.login, {
        login: user.login,
        avatarUrl: user.avatar_url,
        state: 'pending',
        submittedAt: null,
      });
    }
  }

  return { ok: true, data: [...latestByLogin.values()] };
}

/** Commits between `base` and `head` for the staleness banner; 0 when equal (no call). */
export async function getCommitsAhead(
  octokit: GithubClient,
  args: { owner: string; repo: string; base: string; head: string },
): Promise<GithubResult<CommitsAhead>> {
  if (args.base === args.head) return { ok: true, data: { count: 0 } };
  return toResult(async () => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
      owner: args.owner,
      repo: args.repo,
      basehead: `${args.base}...${args.head}`,
    });
    return { count: data.total_commits };
  });
}
