import type { Octokit } from 'octokit';
import { describe, expect, it } from 'vitest';
import { GithubAuthError } from './errors';
import { listOpenPulls } from './pulls';

function mockOctokit(handler: (route: string, params: unknown) => Promise<unknown>): Octokit {
  return { request: handler } as unknown as Octokit;
}

describe('listOpenPulls', () => {
  it('maps the REST pulls payload to PullSummary[]', async () => {
    const captured: Array<{ route: string; params: unknown }> = [];
    const octokit = mockOctokit(async (route, params) => {
      captured.push({ route, params });
      return {
        data: [
          {
            number: 7,
            title: 'Fix the thing',
            state: 'open',
            draft: false,
            user: { login: 'twynsicle', avatar_url: 'https://avatars.example/t.png' },
            head: { ref: 'fix-thing', sha: 'aaa' },
            base: { ref: 'main', sha: 'bbb' },
            html_url: 'https://github.com/o/r/pull/7',
            created_at: '2026-04-20T00:00:00Z',
            updated_at: '2026-04-21T00:00:00Z',
          },
        ],
      };
    });

    const result = await listOpenPulls(octokit, 'o', 'r');
    expect(result).toEqual([
      {
        number: 7,
        title: 'Fix the thing',
        state: 'open',
        draft: false,
        authorLogin: 'twynsicle',
        authorAvatarUrl: 'https://avatars.example/t.png',
        headRef: 'fix-thing',
        headSha: 'aaa',
        baseRef: 'main',
        baseSha: 'bbb',
        htmlUrl: 'https://github.com/o/r/pull/7',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-21T00:00:00Z',
      },
    ]);

    expect(captured[0].route).toBe('GET /repos/{owner}/{repo}/pulls');
    expect(captured[0].params).toMatchObject({
      owner: 'o',
      repo: 'r',
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });
  });

  it('handles deleted/missing author user gracefully', async () => {
    const octokit = mockOctokit(async () => ({
      data: [
        {
          number: 1,
          title: 't',
          state: 'open',
          draft: false,
          user: null,
          head: { ref: 'a', sha: 'x' },
          base: { ref: 'main', sha: 'y' },
          html_url: 'h',
          created_at: 'c',
          updated_at: 'u',
        },
      ],
    }));
    const [pr] = await listOpenPulls(octokit, 'o', 'r');
    expect(pr.authorLogin).toBeNull();
    expect(pr.authorAvatarUrl).toBeNull();
  });

  it('translates 401 to GithubAuthError', async () => {
    const octokit = mockOctokit(async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 });
    });
    await expect(listOpenPulls(octokit, 'o', 'r')).rejects.toBeInstanceOf(GithubAuthError);
  });
});
