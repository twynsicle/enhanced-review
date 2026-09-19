import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BUNDLE_SCHEMA_VERSION, ReviewBundleSchema } from '../review/bundle.ts';
import { injectBundle } from '../review/bundle-html.ts';
import type { NarrativeReview } from '../review/narrative.ts';
import type { RunContext } from './context.ts';
import { runNpmScript, TOOL_ROOT } from './platform.ts';
import type { RunFiles } from './run-folder.ts';
import { note } from './terminal.ts';
import { SHELL_STAMP_FILE, shellSourceStamp } from './shell-stamp.ts';

/**
 * The render stage: the review, its header and both sides of every reviewed
 * file, packed into the report shell as one `review.html`.
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
    files: context.contents,
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
