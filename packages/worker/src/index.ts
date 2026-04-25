import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { readConfigFromEnv } from './config';
import { runOpencodeJob } from './opencode-job';
import { runSession } from './session';
import { runStubJob } from './stub';

/**
 * Worker entrypoint. Connects to Postgres, runs a session until the
 * connection dies, then reconnects with exponential back-off.
 *
 * SIGINT/SIGTERM cause the current connection to be ended cleanly and
 * the loop to exit.
 */
async function main(): Promise<void> {
  const config = readConfigFromEnv();
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let stopping = false;
  let activeClient: Client | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] received ${signal}, shutting down`);
    activeClient?.end().catch(() => {
      /* connection may already be dead */
    });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  let backoff = config.reconnectMinMs;

  while (!stopping) {
    const workerId = randomUUID();
    const pg = new Client({ connectionString: config.databaseUrl });
    activeClient = pg;

    try {
      await pg.connect();
      backoff = config.reconnectMinMs;

      await runSession({
        workerId,
        pg,
        runJob: (job, signal) => {
          if (config.executor === 'stub') {
            // Stub polls status between chunks rather than honouring signal;
            // it predates the cancel-channel rework. Kept available behind
            // REVIEW_EXECUTOR=stub for tests.
            return runStubJob(
              {
                pg,
                supabase,
                sleep: (ms) => delay(ms),
                chunkDelayMs: config.stubChunkDelayMs,
              },
              job,
            ).then(() => undefined);
          }
          return runOpencodeJob(
            { supabase, model: config.reviewModel },
            job,
            signal,
          ).then(() => undefined);
        },
      });
    } catch (err) {
      console.error('[worker] session crashed', err);
    } finally {
      activeClient = null;
      try {
        await pg.end();
      } catch {
        /* swallowed: best-effort cleanup */
      }
    }

    if (stopping) break;

    console.log(`[worker] reconnecting in ${backoff}ms`);
    await delay(backoff);
    backoff = Math.min(backoff * 2, config.reconnectMaxMs);
  }

  console.log('[worker] stopped');
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
