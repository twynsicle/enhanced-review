import type { Octokit } from 'octokit';
import { describe, expect, it, vi } from 'vitest';
import { GithubAuthError } from './errors';
import { listRepos } from './repos';

function mockOctokit(handler: (route: string, params: unknown) => Promise<unknown>): Octokit {
  return { request: handler } as unknown as Octokit;
}

describe('listRepos', () => {
  it('maps GitHub REST payload to RepoSummary', async () => {
    const calls: Array<{ route: string; params: unknown }> = [];
    const octokit = mockOctokit(async (route, params) => {
      calls.push({ route, params });
      return {
        data: [
          {
            owner: { login: 'twynsicle' },
            name: 'diffy',
            full_name: 'twynsicle/diffy',
            description: 'a repo',
            private: false,
            fork: false,
            archived: false,
            default_branch: 'main',
            pushed_at: '2026-04-01T00:00:00Z',
            html_url: 'https://github.com/twynsicle/diffy',
          },
          {
            owner: { login: 'acme' },
            name: 'private-thing',
            full_name: 'acme/private-thing',
            description: null,
            private: true,
            fork: true,
            archived: true,
            default_branch: 'develop',
            pushed_at: null,
            html_url: 'https://github.com/acme/private-thing',
          },
        ],
      };
    });

    const result = await listRepos(octokit);

    expect(result).toEqual([
      {
        owner: 'twynsicle',
        name: 'diffy',
        fullName: 'twynsicle/diffy',
        description: 'a repo',
        private: false,
        fork: false,
        archived: false,
        defaultBranch: 'main',
        pushedAt: '2026-04-01T00:00:00Z',
        htmlUrl: 'https://github.com/twynsicle/diffy',
      },
      {
        owner: 'acme',
        name: 'private-thing',
        fullName: 'acme/private-thing',
        description: null,
        private: true,
        fork: true,
        archived: true,
        defaultBranch: 'develop',
        pushedAt: null,
        htmlUrl: 'https://github.com/acme/private-thing',
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].route).toBe('GET /user/repos');
    expect(calls[0].params).toMatchObject({
      affiliation: 'owner,collaborator,organization_member',
      sort: 'pushed',
      direction: 'desc',
      per_page: 100,
    });
  });

  it('translates a 401 to GithubAuthError', async () => {
    const octokit = mockOctokit(async () => {
      const err = Object.assign(new Error('Bad credentials'), { status: 401 });
      throw err;
    });
    await expect(listRepos(octokit)).rejects.toBeInstanceOf(GithubAuthError);
  });

  it('passes non-auth errors through unchanged', async () => {
    const original = Object.assign(new Error('rate limited'), { status: 403 });
    const octokit = mockOctokit(async () => {
      throw original;
    });
    await expect(listRepos(octokit)).rejects.toBe(original);
  });

  it('falls back to "main" when default_branch is missing', async () => {
    const octokit = mockOctokit(async () => ({
      data: [
        {
          owner: { login: 'x' },
          name: 'y',
          full_name: 'x/y',
          description: null,
          html_url: 'https://github.com/x/y',
        },
      ],
    }));
    const [repo] = await listRepos(octokit);
    expect(repo.defaultBranch).toBe('main');
  });
});

// Silence vitest's unused-import warning when the file only contains describes.
void vi;
