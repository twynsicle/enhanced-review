import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import type { ReviewBundle } from './src/domain/review/bundle.ts';
import { BUNDLE_PLACEHOLDER, injectBundle } from './src/domain/review/bundle-html.ts';
import { VIEWER_STAMP_FILE, viewerSourceStamp } from './src/cli/viewer-stamp.ts';

const TOOL_ROOT = fileURLToPath(new URL('.', import.meta.url));
const VIEWER_ROOT = fileURLToPath(new URL('./src/web/viewer', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./build/viewer', import.meta.url));
// Its own dependency cache: sharing `node_modules/.vite` with the app's dev
// server makes each re-optimise the other's deps, and the app starts answering
// 504 "Outdated Optimize Dep" until it restarts.
const CACHE_DIR = fileURLToPath(new URL('./node_modules/.vite-viewer', import.meta.url));

const SCRIPT_TAG = /<script type="module" crossorigin src="\.\/([^"]+\.js)"><\/script>/g;
const STYLE_TAG = /<link rel="stylesheet" crossorigin href="\.\/([^"]+\.css)">/g;

/**
 * Folds the emitted JS and CSS into the page once the build is on disk, then
 * deletes everything but `viewer.html`, so the report opens from disk with
 * nothing beside it but the source stamp the CLI checks for staleness
 * (`src/cli/viewer-stamp.ts`). Done after the write rather than in `generateBundle`
 * because Rolldown's bundle object ignores `delete`. A `</script` inside the
 * code would end the inline tag early, so it is escaped the way every
 * single-file bundler does.
 */
function inlineIntoHtml(): Plugin {
  return {
    name: 'er-viewer-inline',
    apply: 'build',
    closeBundle() {
      const read = (file: string) => readFileSync(join(OUT_DIR, file), 'utf8');
      const html = read('index.html')
        .replace(SCRIPT_TAG, (_tag, file: string) => {
          const code = read(file).replaceAll('</script', '<\\/script');
          return `<script type="module">${code}</script>`;
        })
        .replace(STYLE_TAG, (_tag, file: string) => `<style>${read(file)}</style>`);
      if (/(?:src|href)="\.\//.test(html)) {
        throw new Error('viewer build: the page still references a separate file');
      }
      if (!html.includes(BUNDLE_PLACEHOLDER)) {
        throw new Error('viewer build: the bundle placeholder did not survive the build');
      }
      for (const entry of readdirSync(OUT_DIR)) rmSync(join(OUT_DIR, entry), { recursive: true });
      writeFileSync(join(OUT_DIR, 'viewer.html'), html);
      writeFileSync(join(OUT_DIR, VIEWER_STAMP_FILE), viewerSourceStamp(TOOL_ROOT));
    },
  };
}

/**
 * `viewer:dev` only: fills the placeholder the way the render stage will,
 * with the JSON file named by `ER_BUNDLE`, or the committed sample. The sample
 * is loaded through the dev server so its `@/` imports resolve, and afresh on
 * every page load, so editing it needs no restart.
 */
function devBundle(): Plugin {
  return {
    name: 'er-viewer-dev-bundle',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      async handler(html, { server }) {
        const file = process.env.ER_BUNDLE;
        if (file) return injectBundle(html, JSON.parse(readFileSync(file, 'utf8')) as ReviewBundle);
        if (!server) throw new Error('viewer:dev: no dev server to load the sample through');
        const sample = (await server.ssrLoadModule('/sample-bundle.ts')) as {
          SAMPLE_BUNDLE: ReviewBundle;
        };
        return injectBundle(html, sample.SAMPLE_BUNDLE);
      },
    },
  };
}

// The local report: the narrative reader as one self-contained HTML file
// (docs/local-mode, D3). No React Router framework plugin — this is a plain
// client-rendered page on a hash data router — and Vite's built-in transform
// handles TSX. Monaco still loads from the CDN at runtime.
export default defineConfig({
  root: VIEWER_ROOT,
  cacheDir: CACHE_DIR,
  base: './',
  publicDir: false,
  resolve: { tsconfigPaths: true },
  plugins: [devBundle(), inlineIntoHtml()],
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
