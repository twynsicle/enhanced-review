import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { SHEET_PLACEHOLDER } from './src/report/sheet/sheet-data.ts';
import { inlineIntoHtml } from './vite.inline.ts';

const SHEET_ROOT = fileURLToPath(new URL('./src/report/sheet', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./build/sheet', import.meta.url));

// The diagram eval's contact sheet: the report's own diagram painters on a
// page of their own, inlined to one file like the report, filled by the
// eval's `sheet` command rather than by `er`.
export default defineConfig({
  root: SHEET_ROOT,
  base: './',
  publicDir: false,
  resolve: { tsconfigPaths: true },
  plugins: [
    inlineIntoHtml({ outDir: OUT_DIR, page: 'sheet.html', placeholder: SHEET_PLACEHOLDER }),
  ],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 10_000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
