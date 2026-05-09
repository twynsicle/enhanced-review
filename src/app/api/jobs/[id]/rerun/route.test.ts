import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock infra dependencies before importing the route. `auth()` returns the
// session shape Auth.js produces; the db/pool are stubbed via a queue-driven
// chainable mock that the test seeds per-scenario.

const sessionRef: { current: { user: { id: string; githubLogin: string | null } } | null } =
  vi.hoisted(() => ({
    current: { user: { id: 'user-2', githubLogin: 'alice' } },
  }));

interface DbState {
  source: { id: string; target: unknown } | null;
  inFlightCount: number;
  insertResult: { id: string };
  insertError?: unknown;
}

const dbState: { current: DbState } = vi.hoisted(() => ({
  current: {
    source: null,
    inFlightCount: 0,
    insertResult: { id: 'new-job-id' },
  },
}));

vi.mock('@/lib/auth/auth', () => ({
  auth: vi.fn(() => Promise.resolve(sessionRef.current)),
}));

vi.mock('@/lib/github/token', () => ({
  getGithubTokenFor: vi.fn().mockResolvedValue('gh-token'),
}));

vi.mock('@/lib/jobs/runner/registry', () => ({
  register: vi.fn(),
  signal: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock('@/lib/jobs/runner/run', () => ({
  runJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/github/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/github/server')>('@/lib/github/server');
  return { ...actual, createServerOctokit: vi.fn() };
});

const insertCallSpy = vi.hoisted(() => vi.fn());

let selectCallIndex = 0;

vi.mock('@/lib/db/client', () => {
  function selectChain(kind: 'source' | 'inflight'): unknown {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn((n: number) => {
      if (kind === 'source') {
        return Promise.resolve(dbState.current.source ? [dbState.current.source] : []);
      }
      const rows = Array.from({ length: dbState.current.inFlightCount }, (_, i) => ({
        id: `inflight-${String(i)}`,
      }));
      return Promise.resolve(rows.slice(0, n));
    });
    return chain;
  }
  function nextSelect(): unknown {
    // Order in route: 1) source lookup, 2) in-flight check (inside txn).
    const kind: 'source' | 'inflight' = selectCallIndex === 0 ? 'source' : 'inflight';
    selectCallIndex += 1;
    return selectChain(kind);
  }

  function insertChain(): unknown {
    const chain: Record<string, unknown> = {};
    chain.values = vi.fn((args: unknown) => {
      insertCallSpy(args);
      return chain;
    });
    chain.returning = vi.fn(() => {
      if (dbState.current.insertError) return Promise.reject(dbState.current.insertError);
      return Promise.resolve([dbState.current.insertResult]);
    });
    return chain;
  }

  function updateChain(): unknown {
    const chain: Record<string, unknown> = {};
    chain.set = vi.fn(() => chain);
    chain.where = vi.fn(() => Promise.resolve());
    return chain;
  }

  const dbStub = {
    select: vi.fn(() => nextSelect()),
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => updateChain()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => nextSelect()),
        insert: vi.fn(() => insertChain()),
      };
      return fn(tx);
    }),
  };
  return {
    db: dbStub,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServerOctokit } from '@/lib/github/server';

const createServerOctokitMock = vi.mocked(createServerOctokit);

const VALID_ID = 'abc123def456789';
const NOT_FOUND_ID = 'notfoundid12345';

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

function fakeOctokit(headSha: string) {
  return {
    request: vi.fn().mockResolvedValue({
      data: {
        title: 'fresh title',
        head: { sha: headSha },
        base: { sha: 'freshBaseSha' },
        commit: { sha: headSha },
      },
    }),
  } as unknown as Awaited<ReturnType<typeof createServerOctokit>>;
}

beforeEach(() => {
  sessionRef.current = { user: { id: 'user-2', githubLogin: 'alice' } };
  dbState.current = {
    source: { id: VALID_ID, target: PR_TARGET },
    inFlightCount: 0,
    insertResult: { id: 'new-job-id' },
  };
  createServerOctokitMock.mockResolvedValue(fakeOctokit('newSha'));
  insertCallSpy.mockClear();
  selectCallIndex = 0;
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
    sessionRef.current = null;
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(401);
  });

  it('returns 404 when source job is not found', async () => {
    dbState.current.source = null;
    const res = await POST(buildRequest(), ctxFor(NOT_FOUND_ID));
    expect(res.status).toBe(404);
  });

  it('refreshes head SHA from GitHub and creates a new job owned by the viewer', async () => {
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'new-job-id' });

    expect(insertCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        githubLogin: 'alice',
        target: { ...PR_TARGET, title: 'fresh title', headSha: 'newSha', baseSha: 'freshBaseSha' },
        status: 'pending',
        headSha: 'newSha',
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
    dbState.current.inFlightCount = 1;
    const res = await POST(buildRequest(), ctxFor(VALID_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'job_in_flight' });
  });
});
