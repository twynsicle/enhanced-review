import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBranchHead,
  getCommitsAhead,
  getFileAtRef,
  getPullMetadata,
  getPullReviewers,
} from './view-time';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): [unknown, unknown] {
  const calls = fetchMock.mock.calls;
  if (calls.length === 0) throw new Error('fetch was not called');
  return calls[calls.length - 1] as [unknown, unknown];
}

describe('getFileAtRef', () => {
  it('decodes base64 content and returns line count + language', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        type: 'file',
        encoding: 'base64',
        size: 14,
        content: Buffer.from('line1\nline2\nx\n', 'utf8').toString('base64'),
      }),
    );

    const result = await getFileAtRef({
      owner: 'acme',
      repo: 'widgets',
      path: 'src/main.ts',
      ref: 'abc',
      token: 't',
    });

    expect(result).toEqual({
      ok: true,
      data: {
        content: 'line1\nline2\nx\n',
        language: 'typescript',
        lineCount: 4,
      },
    });

    const [url, init] = lastCall();
    expect(url).toBe('https://api.github.com/repos/acme/widgets/contents/src/main.ts?ref=abc');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer t');
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('encodes path segments individually so slashes survive', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        type: 'file',
        encoding: 'base64',
        size: 1,
        content: Buffer.from('x', 'utf8').toString('base64'),
      }),
    );

    await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'src/folder name/file with space.ts',
      ref: 'feat/foo',
      token: 't',
    });

    const [url] = lastCall();
    expect(url).toBe(
      'https://api.github.com/repos/a/r/contents/src/folder%20name/file%20with%20space.ts?ref=feat%2Ffoo',
    );
  });

  it('maps 404 to a not-found error (path or ref does not exist)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'gone.ts',
      ref: 'sha',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'not-found', status: 404 } });
  });

  it('maps 403 (with remaining > 0) to a no-access error', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(403, { 'x-ratelimit-remaining': '4998' }));
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'p',
      ref: 's',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'no-access', status: 403 } });
  });

  it('maps 403 (rate-limit-remaining=0) to rate-limited', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(403, { 'x-ratelimit-remaining': '0' }));
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'p',
      ref: 's',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'rate-limited', status: 403 } });
  });

  it('maps 401 to unauthorized (caller redirects to /relink)', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(401));
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'p',
      ref: 's',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
  });

  it('returns too-large when size exceeds 1MB', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        type: 'file',
        encoding: 'base64',
        size: 2_000_000,
        content: '',
      }),
    );
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'big.bin',
      ref: 's',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'too-large' } });
  });

  it('returns not-found when the response is a directory listing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ type: 'file', name: 'a' }]));
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'dir',
      ref: 's',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'not-found' } });
  });

  it('returns unknown when fetch itself throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const result = await getFileAtRef({
      owner: 'a',
      repo: 'r',
      path: 'p',
      ref: 's',
      token: 't',
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unknown', message: 'network down' },
    });
  });
});

describe('getPullMetadata', () => {
  it('flattens the GitHub PR payload into the SummaryCard shape', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        title: 'Add widgets',
        body: 'Description body',
        user: { login: 'alice', avatar_url: 'https://example/avatar' },
        base: { ref: 'main', sha: 'baseSha' },
        head: { ref: 'feat/widgets', sha: 'headSha' },
        changed_files: 3,
        additions: 42,
        deletions: 7,
        html_url: 'https://github.com/a/r/pull/12',
      }),
    );

    const result = await getPullMetadata({
      owner: 'a',
      repo: 'r',
      number: 12,
      token: 't',
    });

    expect(result).toEqual({
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

    const [url] = lastCall();
    expect(url).toBe('https://api.github.com/repos/a/r/pulls/12');
  });

  it('handles a missing PR author gracefully', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        title: 't',
        body: null,
        user: null,
        base: { ref: 'm', sha: 'b' },
        head: { ref: 'h', sha: 'h' },
        changed_files: 0,
        additions: 0,
        deletions: 0,
        html_url: 'u',
      }),
    );
    const result = await getPullMetadata({ owner: 'a', repo: 'r', number: 1, token: 't' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.authorLogin).toBeNull();
      expect(result.data.authorAvatarUrl).toBeNull();
    }
  });

  it('propagates 404 as not-found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));
    const result = await getPullMetadata({ owner: 'a', repo: 'r', number: 99, token: 't' });
    expect(result).toEqual({ ok: false, error: { kind: 'not-found', status: 404 } });
  });
});

describe('getBranchHead', () => {
  it('returns the branch tip SHA and commit message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        name: 'main',
        commit: { sha: 'sha1', commit: { message: 'fix: typo' } },
      }),
    );

    const result = await getBranchHead({ owner: 'a', repo: 'r', ref: 'main', token: 't' });
    expect(result).toEqual({
      ok: true,
      data: { sha: 'sha1', commitMessage: 'fix: typo' },
    });

    const [url] = lastCall();
    expect(url).toBe('https://api.github.com/repos/a/r/branches/main');
  });

  it('encodes branch names with slashes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { name: 'feat/x', commit: { sha: 's' } }));
    await getBranchHead({ owner: 'a', repo: 'r', ref: 'feat/x', token: 't' });
    const [url] = lastCall();
    expect(url).toBe('https://api.github.com/repos/a/r/branches/feat%2Fx');
  });
});

describe('getCommitsAhead', () => {
  it('short-circuits to count=0 when base equals head (no fetch)', async () => {
    const result = await getCommitsAhead({
      owner: 'a',
      repo: 'r',
      base: 'sha',
      head: 'sha',
      token: 't',
    });
    expect(result).toEqual({ ok: true, data: { count: 0 } });
    expect(fetchMock.mock.calls).toHaveLength(0);
  });

  it('returns total_commits from the compare API', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { total_commits: 5 }));
    const result = await getCommitsAhead({
      owner: 'a',
      repo: 'r',
      base: 'old',
      head: 'new',
      token: 't',
    });
    expect(result).toEqual({ ok: true, data: { count: 5 } });
    const [url] = lastCall();
    expect(url).toBe('https://api.github.com/repos/a/r/compare/old...new');
  });

  it('propagates 403 no-access (e.g. private repo, viewer lost membership)', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(403, { 'x-ratelimit-remaining': '5000' }));
    const result = await getCommitsAhead({
      owner: 'a',
      repo: 'r',
      base: 'old',
      head: 'new',
      token: 't',
    });
    expect(result).toEqual({ ok: false, error: { kind: 'no-access', status: 403 } });
  });
});

describe('getPullReviewers', () => {
  it('keeps only the latest review per login and merges in requested reviewers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          user: { login: 'jonas', avatar_url: 'https://example/jonas' },
          state: 'COMMENTED',
          submitted_at: '2026-04-20T10:00:00Z',
        },
        {
          user: { login: 'jonas', avatar_url: 'https://example/jonas' },
          state: 'APPROVED',
          submitted_at: '2026-04-21T12:00:00Z',
        },
        {
          user: { login: 'kira', avatar_url: 'https://example/kira' },
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-04-21T14:00:00Z',
        },
        {
          user: { login: 'noisy', avatar_url: 'https://example/noisy' },
          state: 'DISMISSED',
          submitted_at: '2026-04-21T15:00:00Z',
        },
      ]),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        users: [
          { login: 'newcomer', avatar_url: 'https://example/newcomer' },
          { login: 'jonas', avatar_url: 'https://example/jonas' },
        ],
      }),
    );

    const result = await getPullReviewers({ owner: 'a', repo: 'r', number: 7, token: 't' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byLogin = Object.fromEntries(result.data.map((r) => [r.login, r]));
    expect(Object.keys(byLogin).sort()).toEqual(['jonas', 'kira', 'newcomer']);
    expect(byLogin.jonas).toMatchObject({
      state: 'approved',
      submittedAt: '2026-04-21T12:00:00Z',
    });
    expect(byLogin.kira).toMatchObject({ state: 'changes_requested' });
    expect(byLogin.newcomer).toMatchObject({ state: 'pending', submittedAt: null });
  });

  it('still returns submitted reviews when the requested-reviewers fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          user: { login: 'alice', avatar_url: 'https://example/alice' },
          state: 'APPROVED',
          submitted_at: '2026-04-21T12:00:00Z',
        },
      ]),
    );
    fetchMock.mockResolvedValueOnce(emptyResponse(404));

    const result = await getPullReviewers({ owner: 'a', repo: 'r', number: 7, token: 't' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ login: 'alice', state: 'approved' });
  });

  it('propagates the reviews-endpoint error without calling requested_reviewers', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(401));

    const result = await getPullReviewers({ owner: 'a', repo: 'r', number: 7, token: 't' });
    expect(result).toEqual({ ok: false, error: { kind: 'unauthorized', status: 401 } });
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});
