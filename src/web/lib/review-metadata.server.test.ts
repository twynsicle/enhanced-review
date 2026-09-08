// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubResult, PullMetadata, PullReviewer } from '@/domain/github/types';
import type { ReviewTarget } from '@/domain/review/target';

const client = { createOctokit: vi.fn(() => ({ request: vi.fn(), graphql: vi.fn() })) };
const pulls = { getPullMetadata: vi.fn<() => Promise<GithubResult<PullMetadata>>>() };
const viewTime = {
  getPullReviewers: vi.fn<() => Promise<GithubResult<PullReviewer[]>>>(),
  getBranchHead: vi.fn<() => Promise<GithubResult<{ sha: string; commitMessage: string }>>>(),
  getCommitsAhead: vi.fn<() => Promise<GithubResult<{ count: number }>>>(),
};
vi.mock('@/domain/github/client.server', () => client);
vi.mock('@/domain/github/pull-metadata.server', () => pulls);
vi.mock('@/domain/github/view-time.server', () => viewTime);

const { deriveDurationMs, loadReviewMetadata, EMPTY_REVIEW_METADATA } =
  await import('./review-metadata.server');

const PR: ReviewTarget = {
  kind: 'pr',
  owner: 'o',
  repo: 'r',
  number: 7,
  headSha: 'aaaa',
  baseSha: 'bbbb',
  title: 'Feature',
};
const BRANCH: ReviewTarget = {
  kind: 'branch',
  owner: 'o',
  repo: 'r',
  ref: 'feat/x',
  baseRef: 'main',
  headSha: 'aaaa',
  baseSha: 'bbbb',
};
const METADATA: PullMetadata = {
  title: 'Feature',
  authorLogin: 'alice',
  authorAvatarUrl: null,
  body: 'body',
  baseRefName: 'main',
  headRefName: 'feat/x',
  baseSha: 'bbbb',
  headSha: 'aaaa',
  changedFiles: 2,
  additions: 3,
  deletions: 1,
  htmlUrl: 'https://github.com/o/r/pull/7',
};
const fail = { ok: false as const, error: { kind: 'unauthorized' as const, status: 401 } };

beforeEach(() => {
  vi.clearAllMocks();
  pulls.getPullMetadata.mockResolvedValue({ ok: true, data: METADATA });
  viewTime.getPullReviewers.mockResolvedValue({
    ok: true,
    data: [{ login: 'bob', avatarUrl: null, state: 'approved', submittedAt: null }],
  });
  viewTime.getBranchHead.mockResolvedValue({
    ok: true,
    data: { sha: 'cccc', commitMessage: 'feat: subject\n\nbody' },
  });
  viewTime.getCommitsAhead.mockResolvedValue({ ok: true, data: { count: 3 } });
});

describe('loadReviewMetadata', () => {
  const base = { headSha: 'aaaa', githubLogin: 'owner' };

  it('skips GitHub entirely without a token', async () => {
    const result = await loadReviewMetadata({ ...base, token: null, target: PR });
    expect(result).toEqual(EMPTY_REVIEW_METADATA);
    expect(client.createOctokit).not.toHaveBeenCalled();
  });

  it('PR: header + reviewers, no compare when the head is unchanged', async () => {
    const result = await loadReviewMetadata({ ...base, token: 't', target: PR });
    expect(result.pullMetadata).toEqual(METADATA);
    expect(result.reviewers).toHaveLength(1);
    expect(result.currentHeadSha).toBe('aaaa');
    expect(result.commitsAhead).toBe(0);
    expect(viewTime.getCommitsAhead).not.toHaveBeenCalled();
  });

  it('PR: a moved head counts the commits between the reviewed and current SHAs', async () => {
    pulls.getPullMetadata.mockResolvedValue({ ok: true, data: { ...METADATA, headSha: 'dddd' } });
    const result = await loadReviewMetadata({ ...base, token: 't', target: PR });
    expect(result.currentHeadSha).toBe('dddd');
    expect(result.commitsAhead).toBe(3);
    expect(viewTime.getCommitsAhead).toHaveBeenCalledWith(expect.anything(), {
      owner: 'o',
      repo: 'r',
      base: 'aaaa',
      head: 'dddd',
    });
  });

  it('PR: each section degrades on its own', async () => {
    pulls.getPullMetadata.mockResolvedValue(fail);
    const result = await loadReviewMetadata({ ...base, token: 't', target: PR });
    expect(result.pullMetadata).toBeNull();
    expect(result.currentHeadSha).toBeNull();
    expect(result.reviewers).toHaveLength(1);
  });

  it('branch: synthesises a PR-shaped summary from the branch head', async () => {
    const result = await loadReviewMetadata({ ...base, token: 't', target: BRANCH });
    expect(result.pullMetadata).toMatchObject({
      title: 'feat: subject',
      authorLogin: 'owner',
      headRefName: 'feat/x',
      baseRefName: 'main',
      headSha: 'cccc',
      body: null,
    });
    expect(result.reviewers).toEqual([]);
    expect(result.commitsAhead).toBe(3);
  });

  it('branch: a failed head read leaves the summary to the job', async () => {
    viewTime.getBranchHead.mockResolvedValue(fail);
    const result = await loadReviewMetadata({ ...base, token: 't', target: BRANCH });
    expect(result).toEqual(EMPTY_REVIEW_METADATA);
  });
});

describe('deriveDurationMs', () => {
  it('is the positive span between start and completion', () => {
    const started = new Date('2026-01-01T00:00:00Z');
    expect(deriveDurationMs(started, new Date('2026-01-01T00:00:20Z'))).toBe(20_000);
    expect(deriveDurationMs(started, started)).toBeNull();
    expect(deriveDurationMs(null, started)).toBeNull();
    expect(deriveDurationMs(started, null)).toBeNull();
  });
});
