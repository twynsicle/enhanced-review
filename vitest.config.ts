import { defineConfig } from 'vitest/config';

// Four projects (see docs/rr-migration/00-overview.md):
//   unit         pure server/domain logic, Node environment
//   web          React components + route modules under happy-dom
//   guardrails   repo-reading convention tests
//   integration  real Postgres; skips itself when the DB is unreachable
// `npm test` runs the first three; `npm run test:integration` the last.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/web/**', 'src/guardrails/**', '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['src/web/**/*.test.{ts,tsx}'],
          setupFiles: ['src/web/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'guardrails',
          environment: 'happy-dom',
          include: ['src/guardrails/**/*.test.ts'],
        },
      },
      {
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
