import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Next.js ships `server-only` as a bundled module the webpack/turbopack
      // loader handles specially; under Vitest it isn't resolvable. Map it
      // to a no-op so server-only modules can be unit-tested directly. The
      // runtime guarantee (throws when imported from a client bundle) is
      // preserved by the real Next.js build.
      'server-only': new URL('./test/server-only.shim.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.test.{ts,tsx}',
      '__tests__/**/*.test.{ts,tsx}',
      'packages/*/src/**/*.test.ts',
    ],
  },
});
