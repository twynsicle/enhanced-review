// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubClient } from '@/domain/github/client.server';

const github = {
  withGithub: vi.fn(
    (_request: Request, fn: (client: GithubClient, token: string) => Promise<unknown>) =>
      fn({ request: vi.fn(), graphql: vi.fn() } as unknown as GithubClient, 'tok'),
  ),
  githubFailure: vi.fn((err: unknown) => ({ ok: false, failed: String(err) })),
};
const repos = { listRepos: vi.fn() };
const pulls = { listOpenPulls: vi.fn() };
const branches = { listRecentBranches: vi.fn() };
vi.mock('@/web/lib/github.server', () => github);
vi.mock('@/domain/github/repos.server', () => repos);
vi.mock('@/domain/github/pulls.server', () => pulls);
vi.mock('@/domain/github/branches.server', () => branches);

const reposRoute = await import('./api.github.repos');
const pullsRoute = await import('./api.github.pulls');
const branchesRoute = await import('./api.github.branches');

const request = new Request('http://localhost/api/github/repos');
const args = (params: Record<string, string> = {}) => ({ request, params, context: {} }) as never;

beforeEach(() => vi.clearAllMocks());

describe('/api/github/* loaders', () => {
  it('repos: wraps the list in an ok body', async () => {
    repos.listRepos.mockResolvedValue([{ fullName: 'a/b' }]);
    await expect(reposRoute.loader(args())).resolves.toEqual({
      ok: true,
      repos: [{ fullName: 'a/b' }],
    });
    expect(github.withGithub).toHaveBeenCalledWith(request, expect.any(Function));
  });

  it('repos: returns (not throws) the failure body for a GitHub error', async () => {
    const err = new Error('rate');
    repos.listRepos.mockRejectedValue(err);
    await expect(reposRoute.loader(args())).resolves.toEqual({ ok: false, failed: 'Error: rate' });
    expect(github.githubFailure).toHaveBeenCalledWith(err);
  });

  it('pulls: parses params and echoes fullName', async () => {
    pulls.listOpenPulls.mockResolvedValue([{ number: 1 }]);
    await expect(pullsRoute.loader(args({ owner: 'acme', repo: 'w' }))).resolves.toEqual({
      ok: true,
      fullName: 'acme/w',
      pulls: [{ number: 1 }],
    });
    expect(pulls.listOpenPulls).toHaveBeenCalledWith(expect.anything(), 'acme', 'w');
  });

  it('pulls: rejects a missing param with 400', async () => {
    const thrown = await Promise.resolve()
      .then(() => pullsRoute.loader(args({ owner: 'acme' })))
      .catch((e: unknown) => e);
    expect((thrown as { init?: { status?: number } }).init?.status).toBe(400);
  });

  it('branches: spreads the branch result and echoes fullName', async () => {
    branches.listRecentBranches.mockResolvedValue({
      defaultBranch: 'main',
      defaultBranchSha: 'abc',
      branches: [],
      truncatedToCount: 100,
    });
    await expect(branchesRoute.loader(args({ owner: 'acme', repo: 'w' }))).resolves.toEqual({
      ok: true,
      fullName: 'acme/w',
      defaultBranch: 'main',
      defaultBranchSha: 'abc',
      branches: [],
      truncatedToCount: 100,
    });
  });
});
