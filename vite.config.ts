import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

// Web build only. The Node-only jobs bundle (Phase 5) gets its own config;
// tests are configured in vitest.config.ts so the React Router plugin never
// runs under Vitest.
export default defineConfig({
  plugins: [reactRouter()],
  resolve: { tsconfigPaths: true },
});
