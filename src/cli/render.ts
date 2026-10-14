import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BUNDLE_SCHEMA_VERSION, ReviewBundleSchema, type EmbeddedFile } from '../review/bundle.ts';
import { injectBundle } from '../review/bundle-html.ts';
import type { ContextExcerpt, NarrativeReview } from '../review/narrative.ts';
import type { RunContext } from './context.ts';
import { readExcerpts, textLineCount, type ExcerptContents } from './excerpts.ts';
import { runNpmScript, TOOL_ROOT } from './platform.ts';
import type { RunFiles } from './run-folder.ts';
import { note } from './terminal.ts';
import { SHELL_STAMP_FILE, shellSourceStamp } from './shell-stamp.ts';

/**
 * The render stage: the review, its header and both sides of every reviewed
 * file, packed into the report shell as one `review.html`. Each file an
 * excerpt shows rides along as its excerpted lines at the head commit, cut
 * from the text `excerpts.json` holds; it is in the bundle's `files` only,
 * never the review's, so nothing that counts changed files can count it.
 */
export interface RenderDeps {
  /** The built report shell, placeholder and all. */
  reportShell: () => Promise<string>;
}

export const HOST_RENDER_DEPS: RenderDeps = { reportShell: () => reportShell(TOOL_ROOT) };

export async function renderRun(
  context: RunContext,
  review: NarrativeReview,
  run: RunFiles,
  deps: RenderDeps = HOST_RENDER_DEPS,
  now: Date = new Date(),
): Promise<number> {
  const bundle = ReviewBundleSchema.safeParse({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    meta: context.meta,
    review,
    files: { ...context.contents, ...excerptFiles(review, context, await readExcerpts(run)) },
  });
  if (!bundle.success) {
    throw new Error(
      `the report's data does not fit the report shell:\n${z.prettifyError(bundle.error)}`,
    );
  }
  const html = injectBundle(await deps.reportShell(), bundle.data);
  await writeFile(run.html, html);
  return Buffer.byteLength(html);
}

/**
 * The excerpted files as the bundle carries them: the head side alone, holding
 * only the lines some excerpt shows, every other line up to the last of them
 * blank so each excerpt keeps the file's own numbers. A file may be a
 * megabyte for a sixty-line excerpt, and the report is meant to be emailable.
 *
 * A path the review's excerpts name and the parse stage did not read, one
 * that is also a changed file, or a span past the end of the text it read,
 * means `review.json` and `excerpts.json` came from different parses, and the
 * report would show text that is not the head commit's.
 */
function excerptFiles(
  review: NarrativeReview,
  context: RunContext,
  contents: ExcerptContents,
): Record<string, EmbeddedFile> {
  // Maps, not the records' own keys: a file at the repository root may be
  // called `constructor` or `toString`, which a plain object already answers to.
  const texts = new Map(Object.entries(contents));
  const changed = new Set(Object.keys(context.contents));
  const spans = new Map<string, { text: string; excerpts: ContextExcerpt[] }>();
  for (const chapter of review.chapters) {
    for (const excerpt of chapter.contextExcerpts ?? []) {
      const text = texts.get(excerpt.filename);
      if (
        text === undefined ||
        changed.has(excerpt.filename) ||
        excerpt.endLine > textLineCount(text)
      ) {
        throw new Error(
          `the review's excerpt of ${excerpt.filename} does not match the parse that wrote it; run from parse`,
        );
      }
      const file = spans.get(excerpt.filename) ?? { text, excerpts: [] };
      file.excerpts.push(excerpt);
      spans.set(excerpt.filename, file);
    }
  }
  return Object.fromEntries(
    [...spans].map(([filename, { text, excerpts }]): [string, EmbeddedFile] => {
      const last = Math.max(...excerpts.map((excerpt) => excerpt.endLine));
      const shown = text
        .split('\n')
        .slice(0, last)
        .map((line, at) =>
          excerpts.some((excerpt) => at + 1 >= excerpt.startLine && at + 1 <= excerpt.endLine)
            ? line
            : '',
        );
      return [
        filename,
        { base: { kind: 'absent' }, head: { kind: 'content', content: shown.join('\n') } },
      ];
    }),
  );
}

/**
 * `build/report/shell.html` in the tool's clone, rebuilt first when it is
 * missing or its stamp no longer matches the sources.
 */
export async function reportShell(
  root: string,
  build: (root: string) => Promise<void> = buildShell,
): Promise<string> {
  const dir = path.join(root, 'build', 'report');
  const [html, stamp] = await Promise.all([
    readFile(path.join(dir, 'shell.html'), 'utf8').catch(() => null),
    readFile(path.join(dir, SHELL_STAMP_FILE), 'utf8').catch(() => null),
  ]);
  if (html !== null && stamp?.trim() === shellSourceStamp(root)) return html;
  note(
    html === null
      ? '  building the report shell (first run)'
      : '  rebuilding the report shell (its sources changed)',
  );
  await build(root);
  return readFile(path.join(dir, 'shell.html'), 'utf8');
}

async function buildShell(root: string): Promise<void> {
  const result = await runNpmScript('report:build', root);
  if (result.exitCode !== 0) {
    const tail = result.output.trim().split('\n').slice(-15).join('\n');
    throw new Error(`building the report shell failed (npm run report:build in ${root}):\n${tail}`);
  }
}
