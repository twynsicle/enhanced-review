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

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  // Phase 3: the runner registry registers its own SIGTERM handler to abort
  // in-flight jobs before this close completes.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
