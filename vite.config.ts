import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

// Web build only. The Node-only jobs bundle (Phase 5) gets its own config;
// tests are configured in vitest.config.ts so the React Router plugin never
// runs under Vitest.
export default defineConfig({
  plugins: [reactRouter()],
  resolve: { tsconfigPaths: true },
  // Bundled into build/server instead of imported from node_modules at
  // runtime (phase-5-plan P5-D7), so both can be devDependencies: that keeps
  // the 141 MB icon package out of the image, and with the Monaco wrapper
  // gone from the production tree npm stops installing its 100 MB
  // `monaco-editor` peer too (the editor itself loads from the CDN). Neither
  // dynamic import is ever awaited on the server. Everything else the SSR
  // bundle needs stays external and ships as a production dependency.
  ssr: { noExternal: ['@tabler/icons-react', '@monaco-editor/react'] },
});
