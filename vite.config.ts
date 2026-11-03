import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import type { ReviewBundle } from './src/review/bundle.ts';
import { BUNDLE_PLACEHOLDER, injectBundle } from './src/review/bundle-html.ts';
import { SHELL_STAMP_FILE, shellSourceStamp } from './src/cli/shell-stamp.ts';
import { inlineIntoHtml } from './vite.inline.ts';

const TOOL_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPORT_ROOT = fileURLToPath(new URL('./src/report', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./build/report', import.meta.url));

/**
 * The favicon as a data URI, so it needs no separate file for the browser to
 * fetch and doesn't trip `inlineIntoHtml`'s check for a surviving reference
 * to one.
 */
function favicon(): Plugin {
  const svg = readFileSync(join(REPORT_ROOT, 'chrome/brand-mark.svg'), 'utf8');
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return {
    name: 'er-report-favicon',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href }, injectTo: 'head' },
    ],
  };
}

/**
 * `report:dev` only: fills the placeholder the way the render stage will,
 * with the JSON file named by `ER_BUNDLE`, or the committed sample. The sample
 * is loaded through the dev server so its `@/` imports resolve, and afresh on
 * every page load, so editing it needs no restart.
 */
function devBundle(): Plugin {
  return {
    name: 'er-report-dev-bundle',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      async handler(html, { server }) {
        const file = process.env.ER_BUNDLE;
        if (file) return injectBundle(html, JSON.parse(readFileSync(file, 'utf8')) as ReviewBundle);
        if (!server) throw new Error('report:dev: no dev server to load the sample through');
        const sample = (await server.ssrLoadModule('/sample-bundle.ts')) as {
          SAMPLE_BUNDLE: ReviewBundle;
        };
        return injectBundle(html, sample.SAMPLE_BUNDLE);
      },
    },
  };
}

// The report: the narrative reader as one HTML file. Vite's built-in
// transform handles TSX; Monaco still loads from the CDN at runtime.
export default defineConfig({
  root: REPORT_ROOT,
  base: './',
  publicDir: false,
  resolve: { tsconfigPaths: true },
  plugins: [
    devBundle(),
    favicon(),
    inlineIntoHtml({
      outDir: OUT_DIR,
      page: 'shell.html',
      placeholder: BUNDLE_PLACEHOLDER,
      after: () => {
        writeFileSync(join(OUT_DIR, SHELL_STAMP_FILE), shellSourceStamp(TOOL_ROOT));
      },
    }),
  ],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    // One chunk is the point; Vite's size warning assumes a code-split app.
    chunkSizeWarningLimit: 10_000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
