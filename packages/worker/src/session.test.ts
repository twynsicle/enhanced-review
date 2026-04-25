import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runSession } from './session';
import type { ClaimedJob } from './types';

/**
 * Minimal stand-in for `pg.Client` covering exactly the surface
 * `runSession` consumes: `query`, `on('notification', ...)`, `once('end',
 * ...)`, `once('error', ...)`, and acting as an EventEmitter so the test
 * can fire NOTIFY events.
 */
class FakePg extends EventEmitter {
  readonly queryLog: { sql: string; params?: unknown[] }[] = [];
  pendingClaims: ClaimedJob[] = [];
  // Tracks whether resetRunning has been called so we can assert it
  // happened before the LISTEN.
  resetRunningCount = 0;
  listenCount = 0;
  cancelListenCount = 0;

  query = vi.fn(async (sql: string, params?: unknown[]) => {
    this.queryLog.push({ sql, params });
    if (sql.startsWith('LISTEN review_jobs_pending')) {
      this.listenCount++;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('LISTEN review_jobs_cancel')) {
      this.cancelListenCount++;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("status = 'pending'") && sql.includes("set status = 'pending'")) {
      // resetRunning
      this.resetRunningCount++;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("set status = 'running'")) {
      // claimNext
      const next = this.pendingClaims.shift();
      return next ? { rows: [next], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  fireNotify(jobId: string) {
    this.emit('notification', { channel: 'review_jobs_pending', payload: jobId });
  }

  fireCancel(jobId: string) {
    this.emit('notification', { channel: 'review_jobs_cancel', payload: jobId });
  }

  endConnection() {
    this.emit('end');
  }
}

describe('runSession', () => {
  it('runs reset → listen → drain → wait-for-end in order', async () => {
    const pg = new FakePg();
    const claimed: ClaimedJob = {
      id: 'job-A',
      user_id: 'u',
      github_login: 'alice',
      target: {},
      head_sha: 's',
    };
    pg.pendingClaims = [claimed];

    const ran: string[] = [];
    const runJob = vi.fn(async (job: ClaimedJob, _signal: AbortSignal) => {
      ran.push(job.id);
    });

    const session = runSession({
      // The Pg type is opaque to runSession — we only use `query` and
      // EventEmitter, so the cast is safe in tests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pg: pg as any,
      workerId: 'w-1',
      runJob,
      log: () => {},
    });

    // Give the drain pass a microtask to claim and run the queued job.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(pg.resetRunningCount).toBe(1);
    expect(pg.listenCount).toBe(1);
    expect(ran).toEqual(['job-A']);

    pg.endConnection();
    await session;
  });

  it('claims and runs jobs delivered via NOTIFY', async () => {
    const pg = new FakePg();
    const ran: string[] = [];
    const runJob = vi.fn(async (job: ClaimedJob, _signal: AbortSignal) => {
      ran.push(job.id);
    });

    const session = runSession({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pg: pg as any,
      workerId: 'w-1',
      runJob,
      log: () => {},
    });

    // Wait for the initial drain pass to settle (no pending jobs).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(ran).toEqual([]);

    // Now insert a job and fire NOTIFY.
    pg.pendingClaims.push({
      id: 'job-B',
      user_id: 'u',
      github_login: 'alice',
      target: {},
      head_sha: 's',
    });
    pg.fireNotify('job-B');

    // Let the notify handler run.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(ran).toEqual(['job-B']);

    pg.endConnection();
    await session;
  });

  it('routes a review_jobs_cancel NOTIFY to the in-flight job AbortController', async () => {
    const pg = new FakePg();

    let started = 0;
    let aborted = false;
    const runJob = vi.fn(async (_job: ClaimedJob, signal: AbortSignal) => {
      started += 1;
      // Resolve only when the abort fires.
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          aborted = true;
          resolve();
          return;
        }
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        });
      });
    });

    const session = runSession({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pg: pg as any,
      workerId: 'w-1',
      runJob,
      log: () => {},
    });

    pg.pendingClaims.push({
      id: 'job-X',
      user_id: 'u',
      github_login: 'a',
      target: {},
      head_sha: 's',
    });
    pg.fireNotify('job-X');

    // Let runJob start.
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    expect(started).toBe(1);
    expect(aborted).toBe(false);

    // Now fire the cancel for the running job.
    pg.fireCancel('job-X');
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    expect(aborted).toBe(true);

    // Both LISTENs ran exactly once.
    expect(pg.listenCount).toBe(1);
    expect(pg.cancelListenCount).toBe(1);

    pg.endConnection();
    await session;
  });

  it('drains multiple queued jobs after a single notify', async () => {
    const pg = new FakePg();
    const ran: string[] = [];
    const runJob = vi.fn(async (job: ClaimedJob, _signal: AbortSignal) => {
      ran.push(job.id);
    });

    const session = runSession({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pg: pg as any,
      workerId: 'w-1',
      runJob,
      log: () => {},
    });

    await new Promise((r) => setImmediate(r));

    pg.pendingClaims.push(
      { id: 'job-1', user_id: 'u', github_login: 'a', target: {}, head_sha: 's' },
      { id: 'job-2', user_id: 'u', github_login: 'a', target: {}, head_sha: 's' },
      { id: 'job-3', user_id: 'u', github_login: 'a', target: {}, head_sha: 's' },
    );
    pg.fireNotify('job-1');

    // Each await drains one job through the serializer.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(ran).toEqual(['job-1', 'job-2', 'job-3']);

    pg.endConnection();
    await session;
  });
});
