import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/pb', () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/github/server', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/github/server')>('@/lib/github/server');
  return {
    ...actual,
    createServerOctokit: vi.fn(),
  };
});
vi.mock('@/lib/github/token', () => ({
  getGithubToken: vi.fn(),
  MissingProviderTokenError: class MissingProviderTokenError extends Error {
    constructor(message = 'No GitHub provider token on this Supabase session') {
      super(message);
      this.name = 'MissingProviderTokenError';
    }
  },
}));
vi.mock('@/lib/auth/allowlist', () => ({
  getGithubLogin: vi.fn().mockReturnValue('alice'),
}));

import { NextRequest } from 'next/server';
import { POST } from './route';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerOctokit } from '@/lib/github/server';
import { getGithubToken } from '@/lib/github/token';
import { getCurrentUser } from '@/lib/pb';

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const createServerOctokitMock = vi.mocked(createServerOctokit);
const getGithubTokenMock = vi.mocked(getGithubToken);
const getCurrentUserMock = vi.mocked(getCurrentUser);

// Zod 4's uuid() enforces v4 layout (third group starts with `4`, fourth
// with 8/9/a/b). Use a valid v4 example, not the all-1s pattern.
const VALID_ID = '11111111-1111-4111-8111-111111111111';

function fakeSupabase(opts: { source?: { target: unknown } | null }) {
  const eqMock = vi.fn().mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.source ?? null }),
  });
  return {
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: eqMock }) }),
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function fakeUser(id: string) {
  return { id, github_login: 'alice' } as Awaited<ReturnType<typeof getCurrentUser>>;
}

function fakeAdmin(
  jobId: string | null,
  error: { message: string } | null = null,
  options: { inFlightRows?: { id: string; status: 'pending' | 'running' }[] } = {},
) {
  // Concurrency check uses .from('review_jobs').select().eq().in().order().limit()
  const limit = vi.fn().mockResolvedValue({
    data: options.inFlightRows ?? [],
    error: null,
  });
  const order = vi.fn().mockReturnValue({ limit });
  const inFn = vi.fn().mockReturnValue({ order });
  const eq = vi.fn().mockReturnValue({ in: inFn });
  const select = vi.fn().mockReturnValue({ eq });
  return {
    from: vi.fn().mockReturnValue({ select }),
    rpc: vi.fn().mockResolvedValue({ data: jobId, error }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

function fakeOctokit(headSha: string) {
  return {
    request: vi.fn().mockResolvedValue({
      data: { head: { sha: headSha }, commit: { sha: headSha } },
    }),
  } as unknown as Awaited<ReturnType<typeof createServerOctokit>>;
}

const PR_TARGET = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  headSha: 'oldSha',
  baseSha: 'baseSha',
  title: 't',
};

function buildRequest(): NextRequest {
  return new NextRequest('http://test.local/api/jobs/x/rerun', { method: 'POST' });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) } as RouteContext<'/api/jobs/[id]/rerun'>;
}

beforeEach(() => {
  getCurrentUserMock.mockResolvedValue(fakeUser('user-2'));
  createClientMock.mockResolvedValue(fakeSupabase({ source: { target: PR_TARGET } }));
  createServerOctokitMock.mockResolvedValue(fakeOctokit('newSha'));
  getGithubTokenMock.mockResolvedValue('gh-token');
  createAdminClientMock.mockReturnValue(fakeAdmin('new-job-id'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/jobs/[id]/rerun', () => {
  it('rejects a non-uuid id with 400', async () => {
    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    } as RouteContext<'/api/jobs/[id]/rerun'>);
    expect(res.status).toBe(400);
  });

  it('returns 401 when no session', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(401);
  });

  it('returns 404 when source job is invisible to the viewer', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ source: null }));
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(404);
  });

  it('returns 401 with github_token_invalid when provider_token is missing', async () => {
    const { MissingProviderTokenError } = await import('@/lib/github/token');
    getGithubTokenMock.mockRejectedValueOnce(new MissingProviderTokenError());
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'github_token_invalid' });
  });

  it('refreshes head SHA from GitHub and creates a new job owned by the viewer', async () => {
    const admin = fakeAdmin('new-job-id');
    createAdminClientMock.mockReturnValue(admin);

    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'new-job-id' });

    expect(admin.rpc).toHaveBeenCalledWith(
      'create_review_job_with_token',
      expect.objectContaining({
        p_user_id: 'user-2',
        p_github_login: 'alice',
        p_target: PR_TARGET,
        p_head_sha: 'newSha',
        p_token: 'gh-token',
      }),
    );
  });

  it('returns 502 if GitHub head-SHA refresh fails for non-auth reasons', async () => {
    createServerOctokitMock.mockResolvedValue({
      request: vi.fn().mockRejectedValue(new Error('network')),
    } as unknown as Awaited<ReturnType<typeof createServerOctokit>>);

    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(502);
  });

  it('returns 409 with job_in_flight when the user already has a pending or running job', async () => {
    createAdminClientMock.mockReturnValue(
      fakeAdmin('new-job-id', null, {
        inFlightRows: [{ id: 'existing-job', status: 'running' }],
      }),
    );

    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'job_in_flight', activeJobId: 'existing-job' });
  });
});
