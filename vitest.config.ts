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
          setupFiles: ['src/test/integration-setup.ts'],
        },
      },
    ],
  },
});
