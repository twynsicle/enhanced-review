import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Three projects:
//   unit         the CLI and the review model, Node environment
//   report       the report's React components under happy-dom
//   guardrails   repo-reading convention tests

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
          exclude: ['src/report/**', 'src/guardrails/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'report',
          environment: 'happy-dom',
          include: ['src/report/**/*.test.{ts,tsx}'],
          setupFiles: ['src/report/test/setup.ts'],
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
    ],
  },
});
