/**
 * Loads `.env` from the working directory into the process environment before
 * anything reads it. Imported first by `server/index.ts` so `src/config/env.ts` sees
 * the file's values.
 *
 * Done in code rather than with Node's `--env-file-if-exists` flag because,
 * on Node 24 / Windows, that flag combined with `--watch-path` makes the
 * watcher restart the process continuously.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
