import { describe, expect, it, vi } from 'vitest';
import type { GithubClient } from './client.server.ts';
import { getBranchHead, getCommitsAhead, getFileAtRef } from './view-time.server.ts';

type RequestMock = ReturnType<typeof vi.fn>;

function fakeOctokit(request: RequestMock): GithubClient {
  return { request } as unknown as GithubClient;
}

function ok(data: unknown) {
  return Promise.resolve({ data, status: 200, headers: {} });
}

function httpError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${String(status)}`), { status, response: { headers } });
}

const FILE = { owner: 'acme', repo: 'widgets', path: 'src/main.ts', ref: 'abc' };

describe('getFileAtRef', () => {
  it('decodes base64 content and returns line count + language', async () => {
    const request = vi.fn().mockReturnValueOnce(
      ok({
        type: 'file',
        encoding: 'base64',
        size: 14,
        content: Buffer.from('line1\nline2\nx\n', 'utf8').toString('base64'),
      }),
    );

    await expect(getFileAtRef(fakeOctokit(request), FILE)).resolves.toEqual({
      ok: true,
      data: { content: 'line1\nline2\nx\n', language: 'typescript', lineCount: 4 },
    });
    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: 'acme',
      repo: 'widgets',
      path: 'src/main.ts',
      ref: 'abc',
    });
  });

  it('maps 404 to not-found (path or ref does not exist)', async () => {
    const request = vi.fn().mockRejectedValueOnce(httpError(404));
    await expect(getFileAtRef(fakeOctokit(request), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found', status: 404 },
    });
  });

  it('maps 403 with remaining > 0 to no-access and remaining = 0 to rate-limited', async () => {
    const noAccess = vi
      .fn()
      .mockRejectedValueOnce(httpError(403, { 'x-ratelimit-remaining': '4998' }));
    await expect(getFileAtRef(fakeOctokit(noAccess), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'no-access', status: 403 },
    });

    const limited = vi.fn().mockRejectedValueOnce(httpError(403, { 'x-ratelimit-remaining': '0' }));
    await expect(getFileAtRef(fakeOctokit(limited), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'rate-limited', status: 403 },
    });
  });

  it('maps 401 to unauthorized (caller redirects to /relink)', async () => {
    const request = vi.fn().mockRejectedValueOnce(httpError(401));
    await expect(getFileAtRef(fakeOctokit(request), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'unauthorized', status: 401 },
    });
  });

  it('returns too-large when size exceeds 1MB or content is not inlined', async () => {
    const big = vi
      .fn()
      .mockReturnValueOnce(ok({ type: 'file', encoding: 'base64', size: 2_000_000, content: '' }));
    await expect(getFileAtRef(fakeOctokit(big), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'too-large' },
    });

    const noContent = vi.fn().mockReturnValueOnce(ok({ type: 'file', encoding: 'none', size: 5 }));
    await expect(getFileAtRef(fakeOctokit(noContent), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'too-large' },
    });
  });

  it('returns not-found when the response is a directory listing or a symlink', async () => {
    const dir = vi.fn().mockReturnValueOnce(ok([{ type: 'file', name: 'a' }]));
    await expect(getFileAtRef(fakeOctokit(dir), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
    const link = vi.fn().mockReturnValueOnce(ok({ type: 'symlink', target: 'x' }));
    await expect(getFileAtRef(fakeOctokit(link), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
  });

  it('returns unknown when the request itself throws', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('network down'));
    await expect(getFileAtRef(fakeOctokit(request), FILE)).resolves.toEqual({
      ok: false,
      error: { kind: 'unknown', message: 'network down' },
    });
  });
});

describe('getBranchHead', () => {
  it('returns the branch tip SHA and commit message', async () => {
    const request = vi
      .fn()
      .mockReturnValueOnce(
        ok({ name: 'main', commit: { sha: 'sha1', commit: { message: 'fix: typo' } } }),
      );
    await expect(
      getBranchHead(fakeOctokit(request), { owner: 'a', repo: 'r', ref: 'feat/x' }),
    ).resolves.toEqual({ ok: true, data: { sha: 'sha1', commitMessage: 'fix: typo' } });
    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner: 'a',
      repo: 'r',
      branch: 'feat/x',
    });
  });
});

describe('getCommitsAhead', () => {
  it('short-circuits to count=0 when base equals head (no request)', async () => {
    const request = vi.fn();
    await expect(
      getCommitsAhead(fakeOctokit(request), { owner: 'a', repo: 'r', base: 'sha', head: 'sha' }),
    ).resolves.toEqual({ ok: true, data: { count: 0 } });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns total_commits from the compare API', async () => {
    const request = vi.fn().mockReturnValueOnce(ok({ total_commits: 5 }));
    await expect(
      getCommitsAhead(fakeOctokit(request), { owner: 'a', repo: 'r', base: 'old', head: 'new' }),
    ).resolves.toEqual({ ok: true, data: { count: 5 } });
    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/compare/{basehead}', {
      owner: 'a',
      repo: 'r',
      basehead: 'old...new',
    });
  });

  it('propagates 403 no-access (private repo, viewer lost membership)', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(httpError(403, { 'x-ratelimit-remaining': '5000' }));
    await expect(
      getCommitsAhead(fakeOctokit(request), { owner: 'a', repo: 'r', base: 'old', head: 'new' }),
    ).resolves.toEqual({ ok: false, error: { kind: 'no-access', status: 403 } });
  });
});
