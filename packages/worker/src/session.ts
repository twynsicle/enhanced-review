import type { Client, Notification } from 'pg';
import { claimNext, resetRunning } from './db';
import type { ClaimedJob } from './types';

/**
 * One worker "session" — the lifetime of a single pg connection.
 * The outer `index.ts` reconnect loop calls this once per connection;
 * when it returns, the connection has died and a fresh one is needed.
 *
 * Sequence:
 *   1. Crash recovery sweep (single-worker invariant).
 *   2. Subscribe to NOTIFY before the drain pass so a new insert during
 *      the drain isn't missed.
 *   3. Drain pass: claim every pending row in turn.
 *   4. Wait until the connection ends (an external event) and resolve.
 *
 * Concurrency: claim+run runs serially in this session — at most one
 * job runs at a time. Phase 7 introduces parallel execution.
 */

export interface SessionDeps {
  workerId: string;
  pg: Client;
  runJob: (job: ClaimedJob) => Promise<void>;
  /** Callback for non-fatal logs. Tests pass () => {}. */
  log?: (msg: string, meta?: unknown) => void;
}

export async function runSession(deps: SessionDeps): Promise<void> {
  const { workerId, pg, runJob } = deps;
  const log = deps.log ?? console.log;

  log(`[worker ${workerId}] session started`);

  const reset = await resetRunning(pg);
  if (reset > 0)
    log(`[worker ${workerId}] crash recovery: reset ${reset} running job(s) to pending`);

  // A simple serializer so NOTIFYs that arrive while a previous claim is
  // still in flight don't trigger overlapping queries on the same pg
  // Client (which would interleave responses and confuse pg-protocol).
  let working: Promise<void> = Promise.resolve();
  let dirty = false;
  const trigger = () => {
    dirty = true;
    working = working.then(drain).catch((err) => {
      log(`[worker ${workerId}] drain error`, err);
    });
  };

  async function drain(): Promise<void> {
    while (dirty) {
      dirty = false;
      // Inner loop: keep claiming until the queue is empty. A single
      // NOTIFY may correspond to multiple inserts during the wake-up
      // window (especially after reconnect).
      for (;;) {
        const job = await claimNext(pg, workerId);
        if (!job) break;
        log(`[worker ${workerId}] claimed job ${job.id}`);
        await runJob(job);
      }
    }
  }

  pg.on('notification', (msg: Notification) => {
    if (msg.channel === 'review_jobs_pending') trigger();
  });

  await pg.query('LISTEN review_jobs_pending');

  // Drain anything already pending. After this, the on-notification
  // handler keeps the queue moving.
  trigger();

  // Wait for the connection to die — `runSession` returns and the outer
  // loop reconnects.
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    pg.once('end', done);
    pg.once('error', done);
  });

  // Let any in-flight drain finish before returning so we don't leave a
  // half-completed claim orphaned. Errors here are already logged above.
  try {
    await working;
  } catch {
    /* swallowed: already logged */
  }

  log(`[worker ${workerId}] session ended`);
}
