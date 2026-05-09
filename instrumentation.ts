/**
 * Next.js 16 boot hook. `register()` runs once per server process before
 * route handlers serve requests — used here to wire the SIGTERM handler
 * and flip any orphan `running` rows from a previous container.
 *
 * Skips on the Edge runtime since both helpers depend on the Node Postgres
 * driver and `process.on('SIGTERM')`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { installShutdownHandler } = await import('@/lib/jobs/runner/shutdown');
  installShutdownHandler();

  // Recover orphan jobs in the background so a slow Postgres doesn't
  // block server start. Failures are logged inside `recoverInterruptedJobs`.
  const { recoverInterruptedJobs } = await import('@/lib/jobs/runner/recover-on-startup');
  void recoverInterruptedJobs();
}
