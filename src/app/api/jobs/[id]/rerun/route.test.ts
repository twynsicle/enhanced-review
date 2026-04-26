import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pb', () => ({
  pbAdmin: vi.fn(),
  getCurrentUser: vi.fn(),
  readGithubTokenCookie: vi.fn().mockResolvedValue('gh-token'),
}));
vi.mock('@/lib/github/server', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/github/server')>('@/lib/github/server');
  return {
    ...actual,
    createServerOctokit: vi.fn(),
  };
});
vi.mock('@/lib/auth/allowlist', () => ({
  getGithubLogin: vi.fn().mockReturnValue('alice'),
}));
vi.mock('@/lib/jobs/runner/registry', () => ({
  register: vi.fn(),
  signal: vi.fn(),
  unregister: vi.fn(),
}));
vi.mock('@/lib/jobs/runner/run', () => ({
  runJob: vi.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServerOctokit } from '@/lib/github/server';
import { getCurrentUser, pbAdmin } from '@/lib/pb';

const pbAdminMock = vi.mocked(pbAdmin);
const createServerOctokitMock = vi.mocked(createServerOctokit);
const getCurrentUserMock = vi.mocked(getCurrentUser);

// PB IDs default to 15 alphanumeric chars. Use a representative value
// that matches the route's id schema.
const VALID_ID = 'abc123def456789';
const NOT_FOUND_ID = 'notfoundid12345';

interface FakePbOpts {
  source?: { id: string; target: unknown } | null;
  inFlightRows?: { id: string; status: 'pending' | 'running' }[];
  newJobId?: string;
  insertError?: unknown;
}

function fakePbAdmin(opts: FakePbOpts) {
  const create = vi.fn().mockImplementation(() => {
    if (opts.insertError) return Promise.reject(opts.insertError);
    return Promise.resolve({ id: opts.newJobId ?? 'new-job-id' });
  });
  const getOne = vi.fn().mockImplementation((id: string) => {
    if (opts.source && opts.source.id === id) return Promise.resolve(opts.source);
    return Promise.reject({ status: 404, message: 'not found' });
  });
  const getList = vi.fn().mockResolvedValue({
    page: 1,
    perPage: 1,
    totalItems: opts.inFlightRows?.length ?? 0,
    totalPages: 1,
    items: opts.inFlightRows ?? [],
  });
  const collection = vi.fn(() => ({ create, getOne, getList }));
  return { collection, _create: create, _getOne: getOne, _getList: getList };
}

function fakeUser(id: string) {
  return { id, github_login: 'alice' } as Awaited<ReturnType<typeof getCurrentUser>>;
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
  createServerOctokitMock.mockResolvedValue(fakeOctokit('newSha'));
  const fake = fakePbAdmin({ source: { id: VALID_ID, target: PR_TARGET } });
  pbAdminMock.mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof pbAdmin>>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/jobs/[id]/rerun', () => {
  it('rejects an empty id with 400', async () => {
    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: '' }),
    } as RouteContext<'/api/jobs/[id]/rerun'>);
    expect(res.status).toBe(400);
  });

  it('returns 401 when no session', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(401);
  });

  it('returns 404 when source job is not found', async () => {
    const fake = fakePbAdmin({ source: null });
    pbAdminMock.mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof pbAdmin>>);
    const res = await POST(buildRequest(), ctxFor(NOT_FOUND_ID));
    expect(res.status).toBe(404);
  });

  it('refreshes head SHA from GitHub and creates a new job owned by the viewer', async () => {
    const fake = fakePbAdmin({
      source: { id: VALID_ID, target: PR_TARGET },
      newJobId: 'new-job-id',
    });
    pbAdminMock.mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof pbAdmin>>);

    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'new-job-id' });

    expect(fake._create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-2',
        github_login: 'alice',
        target: PR_TARGET,
        status: 'pending',
        head_sha: 'newSha',
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
    const fake = fakePbAdmin({
      source: { id: VALID_ID, target: PR_TARGET },
      inFlightRows: [{ id: 'existing-job', status: 'running' }],
    });
    pbAdminMock.mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof pbAdmin>>);

    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'job_in_flight', activeJobId: 'existing-job' });
  });
});
