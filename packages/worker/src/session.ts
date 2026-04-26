import type { Client, Notification } from 'pg';
import { claimNext, markRunningAsCrashed, markStuckAsTimedOut, sweepStuckJobs } from './db';
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
 * job runs at a time. Multi-worker / in-process parallelism remain
 * deferred to post-beta.
 *
 * Cancellation: the session subscribes to `review_jobs_cancel` and
 * routes those notifications to a per-job AbortController. The runJob
 * callback receives the signal and is expected to honour it (kill its
 * subprocess, etc.). A NOTIFY missed during a pg reconnect is harmless
 * because the cancelled status is durable in the DB; after reconnect
 * a re-claim or completion-time check will surface it.
 *
 * Per-job timeout: each claim arms a `setTimeout`; if it fires before
 * the job finishes the session writes `error: timeout` directly via pg
 * and aborts the controller. The job's runJob exits via the
 * `signal.aborted` path without writing further status. A periodic
 * sweeper handles the "in-process timer never fired" edge case.
 */

export interface SessionDeps {
  workerId: string;
  pg: Client;
  runJob: (job: ClaimedJob, signal: AbortSignal) => Promise<void>;
  /** Per-job wall-clock budget in ms (e.g. 15 * 60_000). */
  timeoutMs: number;
  /** Periodic stuck-job sweeper cadence in ms. */
  sweepIntervalMs: number;
  /** Callback for non-fatal logs. Tests pass () => {}. */
  log?: (msg: string, meta?: unknown) => void;
}

export async function runSession(deps: SessionDeps): Promise<void> {
  const { workerId, pg, runJob, timeoutMs, sweepIntervalMs } = deps;
  const log = deps.log ?? console.log;

  log(`[worker ${workerId}] session started`);

  const crashed = await markRunningAsCrashed(pg);
  if (crashed > 0)
    log(`[worker ${workerId}] crash recovery: marked ${crashed} stale running job(s) as error`);

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
        const timeoutMin = Math.round(timeoutMs / 60_000);
        const timer = setTimeout(() => {
          // Fire-and-forget: write the error then abort. If the
          // job already finished `markStuckAsTimedOut`'s WHERE clause is a
          // no-op and the abort runs against an already-cleared
          // controller (also a no-op).
          (async () => {
            log(`[worker ${workerId}] job ${job.id} timed out after ${timeoutMin}min`);
            try {
              await markStuckAsTimedOut(
                pg,
                job.id,
                `timeout: job exceeded ${timeoutMin} min`,
              );
            } catch (err) {
              log(`[worker ${workerId}] markStuckAsTimedOut failed for ${job.id}`, err);
            }
            controller.abort();
          })().catch(() => {
            /* swallowed: best-effort */
          });
        }, timeoutMs);
        try {
          await runJob(job, controller.signal);
        } finally {
          clearTimeout(timer);
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

  // Safety-net sweeper: catches any `running` rows the in-process timer
  // missed (e.g. an event-loop stall). Runs concurrently with claims;
  // pg.Client serializes queries internally so no extra locking needed.
  const sweepTimer = setInterval(() => {
    sweepStuckJobs(pg, timeoutMs)
      .then((swept) => {
        if (swept > 0)
          log(`[worker ${workerId}] sweeper: errored ${swept} stuck job(s)`);
      })
      .catch((err) => {
        log(`[worker ${workerId}] sweeper failed`, err);
      });
  }, sweepIntervalMs);

  trigger();

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    pg.once('end', done);
    pg.once('error', done);
  });

  clearInterval(sweepTimer);

  try {
    await working;
  } catch {
    /* swallowed: already logged */
  }

  log(`[worker ${workerId}] session ended`);
}
