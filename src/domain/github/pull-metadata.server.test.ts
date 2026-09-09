import { describe, expect, it, vi } from 'vitest';
import type { GithubClient } from './client.server.ts';
import { getPullMetadata } from './pull-metadata.server.ts';

function octokitReturning(data: unknown): GithubClient & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn().mockResolvedValue({ data });
  return { request } as unknown as GithubClient & { request: ReturnType<typeof vi.fn> };
}

describe('getPullMetadata', () => {
  it('flattens the GitHub PR payload', async () => {
    const octokit = octokitReturning({
      title: 'Add widgets',
      body: 'Description body',
      user: { login: 'alice', avatar_url: 'https://example/avatar' },
      base: { ref: 'main', sha: 'baseSha' },
      head: { ref: 'feat/widgets', sha: 'headSha' },
      changed_files: 3,
      additions: 42,
      deletions: 7,
      html_url: 'https://github.com/a/r/pull/12',
    });

    await expect(getPullMetadata(octokit, { owner: 'a', repo: 'r', number: 12 })).resolves.toEqual({
      ok: true,
      data: {
        title: 'Add widgets',
        authorLogin: 'alice',
        authorAvatarUrl: 'https://example/avatar',
        body: 'Description body',
        baseRefName: 'main',
        headRefName: 'feat/widgets',
        baseSha: 'baseSha',
        headSha: 'headSha',
        changedFiles: 3,
        additions: 42,
        deletions: 7,
        htmlUrl: 'https://github.com/a/r/pull/12',
      },
    });
    expect(octokit.request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      expect.objectContaining({ owner: 'a', repo: 'r', pull_number: 12 }),
    );
  });

  it('handles a missing PR author gracefully', async () => {
    const octokit = octokitReturning({
      title: 't',
      body: null,
      user: null,
      base: { ref: 'm', sha: 'b' },
      head: { ref: 'h', sha: 'h' },
      changed_files: 0,
      additions: 0,
      deletions: 0,
      html_url: 'u',
    });
    const result = await getPullMetadata(octokit, { owner: 'a', repo: 'r', number: 1 });
    expect(result).toMatchObject({
      ok: true,
      data: { authorLogin: null, authorAvatarUrl: null, body: null },
    });
  });

  it('forwards the abort signal to the request', async () => {
    const octokit = octokitReturning({
      title: 't',
      body: null,
      user: null,
      base: { ref: 'm', sha: 'b' },
      head: { ref: 'h', sha: 'h' },
      changed_files: 0,
      additions: 0,
      deletions: 0,
      html_url: 'u',
    });
    const signal = new AbortController().signal;
    await getPullMetadata(octokit, { owner: 'a', repo: 'r', number: 1 }, signal);
    expect(octokit.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ request: { signal } }),
    );
  });

  it('propagates 404 as not-found', async () => {
    const octokit = {
      request: vi.fn().mockRejectedValue({ status: 404 }),
    } as unknown as GithubClient;
    await expect(getPullMetadata(octokit, { owner: 'a', repo: 'r', number: 99 })).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found', status: 404 },
    });
  });
});
