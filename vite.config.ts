import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import type { ReviewBundle } from './src/review/bundle.ts';
import { BUNDLE_PLACEHOLDER, injectBundle } from './src/review/bundle-html.ts';
import { SHELL_STAMP_FILE, shellSourceStamp } from './src/cli/shell-stamp.ts';

const TOOL_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPORT_ROOT = fileURLToPath(new URL('./src/report', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./build/report', import.meta.url));

const SCRIPT_TAG = /<script type="module" crossorigin src="\.\/([^"]+\.js)"><\/script>/g;
const STYLE_TAG = /<link rel="stylesheet" crossorigin href="\.\/([^"]+\.css)">/g;

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
 * Folds the emitted JS and CSS into the page once the build is on disk, then
 * deletes everything but `shell.html`, so the report opens from disk with
 * nothing beside it but the source stamp the CLI checks for staleness
 * (`src/cli/shell-stamp.ts`). Done after the write rather than in `generateBundle`
 * because Rolldown's bundle object ignores `delete`. A `</script` inside the
 * code would end the inline tag early, so it is escaped the way every
 * single-file bundler does.
 */
function inlineIntoHtml(): Plugin {
  return {
    name: 'er-report-inline',
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
        throw new Error('report build: the page still references a separate file');
      }
      if (!html.includes(BUNDLE_PLACEHOLDER)) {
        throw new Error('report build: the bundle placeholder did not survive the build');
      }
      for (const entry of readdirSync(OUT_DIR)) rmSync(join(OUT_DIR, entry), { recursive: true });
      writeFileSync(join(OUT_DIR, 'shell.html'), html);
      writeFileSync(join(OUT_DIR, SHELL_STAMP_FILE), shellSourceStamp(TOOL_ROOT));
    },
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
  plugins: [devBundle(), favicon(), inlineIntoHtml()],
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
