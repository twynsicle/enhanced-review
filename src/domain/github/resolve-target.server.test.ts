import { describe, expect, it, vi } from 'vitest';
import type { ReviewTarget } from '../review/target.ts';
import { GithubAuthError, type GithubClient } from './client.server.ts';
import { resolveFreshReviewTarget } from './resolve-target.server.ts';

const PR: ReviewTarget = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  headSha: 'oldHead',
  baseSha: 'oldBase',
  title: 'old title',
};

const BRANCH: ReviewTarget = {
  kind: 'branch',
  owner: 'acme',
  repo: 'widgets',
  ref: 'feature',
  baseRef: 'main',
  headSha: 'oldHead',
  baseSha: 'oldBase',
};

describe('resolveFreshReviewTarget', () => {
  it('re-pins a PR to the current head/base SHAs and title', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { title: 'fresh title', head: { sha: 'newHead' }, base: { sha: 'newBase' } },
    });
    const octokit = { request } as unknown as GithubClient;

    await expect(resolveFreshReviewTarget(octokit, PR)).resolves.toEqual({
      target: { ...PR, title: 'fresh title', headSha: 'newHead', baseSha: 'newBase' },
      headSha: 'newHead',
    });
    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: 'acme',
      repo: 'widgets',
      pull_number: 12,
    });
  });

  it('re-pins a branch pair from both branch tips', async () => {
    const request = vi
      .fn()
      .mockImplementation((_route: string, params: { branch: string }) =>
        Promise.resolve({ data: { commit: { sha: `${params.branch}-sha` } } }),
      );
    const octokit = { request } as unknown as GithubClient;

    await expect(resolveFreshReviewTarget(octokit, BRANCH)).resolves.toEqual({
      target: { ...BRANCH, headSha: 'feature-sha', baseSha: 'main-sha' },
      headSha: 'feature-sha',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('translates 401 to GithubAuthError and passes other errors through', async () => {
    const auth = { request: vi.fn().mockRejectedValue({ status: 401 }) } as unknown as GithubClient;
    await expect(resolveFreshReviewTarget(auth, PR)).rejects.toBeInstanceOf(GithubAuthError);

    const network = new Error('network');
    const other = { request: vi.fn().mockRejectedValue(network) } as unknown as GithubClient;
    await expect(resolveFreshReviewTarget(other, BRANCH)).rejects.toBe(network);
  });
});
