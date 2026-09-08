/**
 * Express 5 bootstrap for the React Router app.
 *
 * Runs as a single Node process — the review runner (Phase 3) lives in this
 * process and holds an in-memory AbortController registry, so this server
 * must never be run under a forking/cluster process manager. Scale is
 * "one container, one process".
 *
 * Executed directly by Node (type stripping, no build step), so imports of
 * project code are relative with explicit `.ts` extensions; `@/` aliases are
 * resolved only by Vite for the web bundle.
 *
 *   development  Vite in middleware mode: HMR, on-the-fly SSR module loading.
 *   production   Serves the `build/` output produced by `react-router build`.
 */
import '../src/config/load-env.ts';
import { createRequestHandler } from '@react-router/express';
import express from 'express';
import type { ServerBuild } from 'react-router';
import { env } from '../src/config/env.ts';
import { logger } from '../src/common/logger.ts';
import { JOBS_REGISTRY_KEY, type JobRegistryHandle } from '../src/domain/jobs/registry.server.ts';

const app = express();
app.disable('x-powered-by');

if (env.NODE_ENV === 'production') {
  // Hashed assets are immutable; everything else in build/client for an hour.
  app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }));
  app.use(express.static('build/client', { maxAge: '1h' }));
  app.use(
    createRequestHandler({
      // @ts-expect-error build output is untyped until `react-router build` runs
      build: await import('../build/server/index.js'),
    }),
  );
} else {
  const vite = await import('vite').then((mod) =>
    mod.createServer({ server: { middlewareMode: true } }),
  );
  app.use(vite.middlewares);
  app.use(
    createRequestHandler({
      build: () => vite.ssrLoadModule('virtual:react-router/server-build') as Promise<ServerBuild>,
    }),
  );
}

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, mode: env.NODE_ENV }, 'server listening');
});

// The job registry lives on globalThis (phase-3-plan P3-D7) because Vite
// evaluates its own module instances in development; this file is outside
// that graph, so it reaches the registry by its well-known key instead of an
// import. Undefined until the first job has run.
function jobRegistry(): JobRegistryHandle | undefined {
  return (globalThis as Record<symbol, unknown>)[JOBS_REGISTRY_KEY] as
    JobRegistryHandle | undefined;
}

// Drain budget for in-flight jobs: enough for the runner to write its
// "interrupted" status, well inside the hard exit below.
const JOB_DRAIN_MS = 5_000;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  const jobs = jobRegistry();
  if (jobs && jobs.size() > 0) {
    const aborted = jobs.abortAll('shutdown');
    logger.info({ aborted }, 'aborting in-flight jobs');
    await jobs.drain(JOB_DRAIN_MS);
  }
  server.close(() => process.exit(0));
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
