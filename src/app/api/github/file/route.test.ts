import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pb', () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/github/token', () => ({
  getGithubToken: vi.fn(),
  MissingProviderTokenError: class MissingProviderTokenError extends Error {
    constructor(message = 'No GitHub provider token on this Supabase session') {
      super(message);
      this.name = 'MissingProviderTokenError';
    }
  },
}));
vi.mock('@/lib/github/view-time', () => ({
  getFileAtRef: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from './route';
import { getCurrentUser } from '@/lib/pb';
import { MissingProviderTokenError, getGithubToken } from '@/lib/github/token';
import { getFileAtRef } from '@/lib/github/view-time';

const getCurrentUserMock = vi.mocked(getCurrentUser);
const getGithubTokenMock = vi.mocked(getGithubToken);
const getFileAtRefMock = vi.mocked(getFileAtRef);

function fakeUser(id: string) {
  return { id, github_login: 'alice' } as Awaited<ReturnType<typeof getCurrentUser>>;
}

function buildRequest(query: Record<string, string>): NextRequest {
  const url = new URL('http://test.local/api/github/file');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const VALID_QUERY = {
  owner: 'acme',
  repo: 'widgets',
  path: 'src/main.ts',
  ref: 'abc123',
};

beforeEach(() => {
  getCurrentUserMock.mockResolvedValue(fakeUser('user-1'));
  getGithubTokenMock.mockResolvedValue('gh-token');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/github/file', () => {
  it('returns 401 when no session', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const res = await GET(buildRequest(VALID_QUERY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ message: 'unauthorized' });
    expect(getFileAtRefMock).not.toHaveBeenCalled();
  });

  it('returns 400 when query params are missing', async () => {
    const res = await GET(buildRequest({ owner: 'a' }));
    expect(res.status).toBe(400);
    expect(getFileAtRefMock).not.toHaveBeenCalled();
  });

  it('returns 401 with github_token_invalid when provider_token is missing', async () => {
    getGithubTokenMock.mockRejectedValueOnce(new MissingProviderTokenError());

    const res = await GET(buildRequest(VALID_QUERY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'github_token_invalid' });
  });

  it('returns 401 with github_token_invalid when GitHub rejects the token', async () => {
    getFileAtRefMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unauthorized', status: 401 },
    });

    const res = await GET(buildRequest(VALID_QUERY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'github_token_invalid' });
  });

  it('passes the viewer token through to getFileAtRef and returns 200 on success', async () => {
    getFileAtRefMock.mockResolvedValueOnce({
      ok: true,
      data: { content: 'hi', language: 'typescript', lineCount: 1 },
    });

    const res = await GET(buildRequest(VALID_QUERY));
    expect(res.status).toBe(200);
    expect(getFileAtRefMock).toHaveBeenCalledWith({ ...VALID_QUERY, token: 'gh-token' });
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { content: 'hi', language: 'typescript', lineCount: 1 },
    });
  });

  it('passes through graceful no-access / not-found errors as 200 ok:false bodies', async () => {
    getFileAtRefMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'no-access', status: 403 },
    });

    const res = await GET(buildRequest(VALID_QUERY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { kind: 'no-access', status: 403 } });
  });

  it('passes through too-large and rate-limited as 200 ok:false bodies', async () => {
    getFileAtRefMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'too-large' },
    });

    const res = await GET(buildRequest(VALID_QUERY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { kind: 'too-large' } });
  });
});
