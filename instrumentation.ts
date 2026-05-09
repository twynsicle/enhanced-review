/**
 * Next.js 16 boot hook. `register()` runs once per server process before
 * route handlers serve requests — used here to wire the SIGTERM handler.
 *
 * Orphan-job recovery used to live here too. Phase B moved it to a
 * standalone CJS script (`scripts/recover-jobs.cjs`) that runs from the
 * Docker entrypoint *before* `node server.js` starts, so the data layer
 * is consistent before any request handler can serve a stale row. For
 * the host-dev (Flow 2) path, run `npm run db:recover` after a crash.
 *
 * Skips on the Edge runtime since `process.on('SIGTERM')` and the pg
 * driver only exist in Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { installShutdownHandler } = await import('@/lib/jobs/runner/shutdown');
  installShutdownHandler();
}
