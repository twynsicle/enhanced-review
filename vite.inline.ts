import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const SCRIPT_TAG = /<script type="module" crossorigin src="\.\/([^"]+\.js)"><\/script>/g;
const STYLE_TAG = /<link rel="stylesheet" crossorigin href="\.\/([^"]+\.css)">/g;

export interface InlineOptions {
  outDir: string;
  /** The one file left in `outDir`. */
  page: string;
  /** The empty data element the page is filled through, which must survive the build. */
  placeholder: string;
  /** Anything else to write beside the page once it is there. */
  after?: () => void;
}

/**
 * Folds the emitted JS and CSS into the page once the build is on disk, then
 * deletes everything but the page, so it opens from disk with nothing beside
 * it: a module script loaded from a file URL is refused by the browser. Done
 * after the write rather than in `generateBundle` because Rolldown's bundle
 * object ignores `delete`. A `</script` inside the code would end the inline
 * tag early, so it is escaped the way every single-file bundler does. Shared
 * by the report and the diagram eval's contact sheet.
 */
export function inlineIntoHtml({ outDir, page, placeholder, after }: InlineOptions): Plugin {
  return {
    name: `er-inline-${page}`,
    apply: 'build',
    closeBundle() {
      const read = (file: string) => readFileSync(join(outDir, file), 'utf8');
      const html = read('index.html')
        .replace(SCRIPT_TAG, (_tag, file: string) => {
          const code = read(file).replaceAll('</script', '<\\/script');
          return `<script type="module">${code}</script>`;
        })
        .replace(STYLE_TAG, (_tag, file: string) => `<style>${read(file)}</style>`);
      if (/(?:src|href)="\.\//.test(html)) {
        throw new Error(`${page}: the page still references a separate file`);
      }
      if (!html.includes(placeholder)) {
        throw new Error(`${page}: the data placeholder did not survive the build`);
      }
      for (const entry of readdirSync(outDir)) rmSync(join(outDir, entry), { recursive: true });
      writeFileSync(join(outDir, page), html);
      after?.();
    },
  };
}
