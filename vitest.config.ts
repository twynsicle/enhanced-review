import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Four projects (see docs/rr-migration/00-overview.md):
//   unit         pure server/domain logic, Node environment
//   web          React components + route modules under happy-dom
//   guardrails   repo-reading convention tests
//   integration  real Postgres; skips itself when the DB is unreachable
// `npm test` runs the first three; `npm run test:integration` the last.

// Mirrors tsconfig `paths`. Vitest does not pick up Vite's
// `resolve.tsconfigPaths`, so the alias is spelled out here. Forward slashes
// keep directory-index resolution working on Windows.
const srcDir = fileURLToPath(new URL('./src', import.meta.url))
  .split(sep)
  .join('/');

// `src/config/env.ts` requires the database and auth keys. Tests use the
// developer's `.env` when there is one and fall back to placeholders for
// whatever is missing, so `npm run check` needs no `.env` at all
// (phase-2-plan P2-D9). Workers inherit process.env from this process.
if (existsSync('.env')) process.loadEnvFile('.env');
const TEST_ENV_DEFAULTS: Record<string, string> = {
  DATABASE_URL: 'postgresql://enhanced_review:enhanced_review@127.0.0.1:5432/enhanced_review',
  SESSION_SECRET: 'vitest-session-secret-not-for-real-use-0123456789',
  GITHUB_CLIENT_ID: 'vitest-client-id',
  GITHUB_CLIENT_SECRET: 'vitest-client-secret',
  APP_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  // No test may reach the Claude Agent SDK by accident.
  REVIEW_EXECUTOR: 'stub',
};
for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  process.env[key] ??= value;
}

export default defineConfig({
  resolve: {
    alias: { '@': srcDir },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/web/**', 'src/guardrails/**', '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['src/web/**/*.test.{ts,tsx}'],
          setupFiles: ['src/web/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'guardrails',
          environment: 'happy-dom',
          include: ['src/guardrails/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['src/test/integration-global-setup.ts'],
          // Files share one database and truncate it between tests.
          fileParallelism: false,
        },
      },
    ],
  },
});
