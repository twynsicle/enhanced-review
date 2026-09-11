import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const VIEWER_ROOT = fileURLToPath(new URL('./src/web/viewer', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./build/viewer', import.meta.url));

const SCRIPT_TAG = /<script type="module" crossorigin src="\.\/([^"]+\.js)"><\/script>/g;
const STYLE_TAG = /<link rel="stylesheet" crossorigin href="\.\/([^"]+\.css)">/g;

/**
 * Folds the emitted JS and CSS into the page once the build is on disk, then
 * deletes everything but `viewer.html`, so the report opens from disk with
 * nothing beside it. Done after the write rather than in `generateBundle`
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
      for (const entry of readdirSync(OUT_DIR)) rmSync(join(OUT_DIR, entry), { recursive: true });
      writeFileSync(join(OUT_DIR, 'viewer.html'), html);
    },
  };
}

// The local report: the narrative reader as one self-contained HTML file
// (docs/local-mode, D3). No React Router framework plugin — this is a plain
// client-rendered page on a hash data router — and Vite's built-in transform
// handles TSX. Monaco still loads from the CDN at runtime.
export default defineConfig({
  root: VIEWER_ROOT,
  base: './',
  publicDir: false,
  resolve: { tsconfigPaths: true },
  plugins: [inlineIntoHtml()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
