/**
 * Standalone orphan-job recovery. Runs from the container entrypoint
 * before `node server.js` accepts requests, and is also exposed via
 * `npm run db:recover` for the Flow 2 dev path (host `npm run dev` after
 * a crash).
 *
 * If the previous container died mid-job (deploy, crash, OOM), rows in
 * `review_jobs` with `status='running'` have no in-process runner. Flip
 * them to `status='error'` and emit terminal NOTIFYs so any subscriber
 * that reconnects sees a final state instead of waiting forever.
 *
 * Pure CommonJS, depends only on `pg`. Avoids the Next.js standalone
 * tree's bundled module layout (which would be brittle to import paths)
 * and avoids needing `tsx` / Drizzle in the runtime image.
 *
 * Failure policy: a recovery error never blocks startup. The data layer
 * is just stale; the live view will show the next attempt cleanly.
 */
const { Pool } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to recover interrupted jobs.');
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query(
      `UPDATE review_jobs
          SET status = 'error',
              completed_at = now(),
              error_message = 'Container restarted; in-flight job lost',
              updated_at = now()
        WHERE status = 'running'
        RETURNING id, user_id`,
    );

    for (const row of rows) {
      const jobPayload = JSON.stringify({
        type: 'status',
        status: 'error',
        errorMessage: 'Container restarted; in-flight job lost',
      });
      const userPayload = JSON.stringify({ jobId: row.id, status: 'error' });
      try {
        await pool.query('SELECT pg_notify($1, $2)', [`job_${row.id}`, jobPayload]);
        await pool.query('SELECT pg_notify($1, $2)', [`user_${row.user_id}:terminal`, userPayload]);
      } catch (err) {
        console.warn(`[recover] notify failed for job ${row.id}:`, err && err.message);
      }
    }

    if (rows.length > 0) {
      console.log(`[recover] flipped ${rows.length} orphan running rows to error`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[recover] failed:', err && err.message ? err.message : err);
  // Never block startup on a recovery failure.
  process.exit(0);
});
