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
 *   2. Subscribe to NOTIFY channels (pending + cancel) before the drain
 *      pass so a new insert during the drain isn't missed.
 *   3. Drain pass: claim every pending row in turn.
 *   4. Wait until the connection ends (an external event) and resolve.
 *
 * Concurrency: claim+run runs serially in this session — at most one
 * job runs at a time. Phase 7 introduces parallel execution.
 *
 * Cancellation: the session subscribes to `review_jobs_cancel` and
 * routes those notifications to a per-job AbortController. The runJob
 * callback receives the signal and is expected to honour it (kill its
 * subprocess, etc.). A NOTIFY missed during a pg reconnect is harmless
 * because the cancelled status is durable in the DB; after reconnect
 * a re-claim or completion-time check will surface it.
 */

export interface SessionDeps {
  workerId: string;
  pg: Client;
  runJob: (job: ClaimedJob, signal: AbortSignal) => Promise<void>;
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

  // Active job → AbortController. NOTIFY 'review_jobs_cancel' arrives with
  // payload = job id; we abort the matching controller (if any).
  const activeControllers = new Map<string, AbortController>();

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
      for (;;) {
        const job = await claimNext(pg, workerId);
        if (!job) break;
        log(`[worker ${workerId}] claimed job ${job.id}`);
        const controller = new AbortController();
        activeControllers.set(job.id, controller);
        try {
          await runJob(job, controller.signal);
        } finally {
          activeControllers.delete(job.id);
        }
      }
    }
  }

  pg.on('notification', (msg: Notification) => {
    if (msg.channel === 'review_jobs_pending') {
      trigger();
      return;
    }
    if (msg.channel === 'review_jobs_cancel' && msg.payload) {
      const controller = activeControllers.get(msg.payload);
      if (controller) {
        log(`[worker ${workerId}] cancel signal for job ${msg.payload}`);
        controller.abort();
      }
    }
  });

  await pg.query('LISTEN review_jobs_pending');
  await pg.query('LISTEN review_jobs_cancel');

  trigger();

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    pg.once('end', done);
    pg.once('error', done);
  });

  try {
    await working;
  } catch {
    /* swallowed: already logged */
  }

  log(`[worker ${workerId}] session ended`);
}
