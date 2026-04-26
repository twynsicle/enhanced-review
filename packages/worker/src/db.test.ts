import { describe, expect, it, vi } from 'vitest';
import {
  claimNext,
  markRunningAsCrashed,
  markStuckAsTimedOut,
  type Querier,
  selectStatus,
  sweepStuckJobs,
} from './db';

interface FakeRow {
  id: string;
  user_id: string;
  github_login: string;
  target: unknown;
  head_sha: string;
}

interface FakePg extends Querier {
  calls: { sql: string; params?: unknown[] }[];
}

function fakePg(handler: (sql: string, params?: unknown[]) => unknown): FakePg {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const query = vi.fn((sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const result = handler(sql, params);
    return Promise.resolve(result ?? { rows: [], rowCount: 0 });
  });
  return { calls, query: query as unknown as Querier['query'] };
}

describe('markRunningAsCrashed', () => {
  it('marks every running row as error with worker_crashed', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 3 }));
    const crashed = await markRunningAsCrashed(pg);
    expect(crashed).toBe(3);
    expect(pg.calls[0]?.sql).toContain("set status = 'error'");
    expect(pg.calls[0]?.sql).toContain("where status = 'running'");
    expect(pg.calls[0]?.sql).toContain("error_message = 'worker crashed");
  });

  it('returns 0 when nothing was running', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 0 }));
    expect(await markRunningAsCrashed(pg)).toBe(0);
  });
});

describe('markStuckAsTimedOut', () => {
  it('marks the row error only when status is still running', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 1 }));
    const updated = await markStuckAsTimedOut(pg, 'job-1', 'timeout: 15 min');
    expect(updated).toBe(1);
    expect(pg.calls[0]?.params).toEqual(['job-1', 'timeout: 15 min']);
    expect(pg.calls[0]?.sql).toContain("status = 'running'");
    expect(pg.calls[0]?.sql).toContain('id = $1');
  });

  it('is a no-op when the job already left the running state', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 0 }));
    expect(await markStuckAsTimedOut(pg, 'job-x', 'timeout')).toBe(0);
  });
});

describe('sweepStuckJobs', () => {
  it('errors rows whose started_at is older than the timeout', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 2 }));
    const swept = await sweepStuckJobs(pg, 15 * 60_000);
    expect(swept).toBe(2);
    expect(pg.calls[0]?.sql).toContain("status = 'running'");
    expect(pg.calls[0]?.sql).toContain('started_at < now()');
    expect(pg.calls[0]?.params).toEqual([15 * 60_000]);
  });
});

describe('claimNext', () => {
  it('returns the claimed row', async () => {
    const row: FakeRow = {
      id: 'job-1',
      user_id: 'user-1',
      github_login: 'alice',
      target: { kind: 'pr' },
      head_sha: 'abc123',
    };
    const pg = fakePg(() => ({ rows: [row], rowCount: 1 }));
    const claimed = await claimNext(pg, 'worker-1');
    expect(claimed).toEqual(row);
    expect(pg.calls[0]?.params).toEqual(['worker-1']);
    expect(pg.calls[0]?.sql).toContain('for update skip locked');
  });

  it('returns null when nothing is pending', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 0 }));
    expect(await claimNext(pg, 'worker-1')).toBeNull();
  });
});

describe('selectStatus', () => {
  it('returns the row status', async () => {
    const pg = fakePg(() => ({ rows: [{ status: 'cancelled' }], rowCount: 1 }));
    expect(await selectStatus(pg, 'job-1')).toBe('cancelled');
  });

  it('returns null when the row is missing', async () => {
    const pg = fakePg(() => ({ rows: [], rowCount: 0 }));
    expect(await selectStatus(pg, 'job-missing')).toBeNull();
  });
});
