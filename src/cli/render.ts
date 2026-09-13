import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BUNDLE_SCHEMA_VERSION, ReviewBundleSchema } from '../domain/review/bundle.ts';
import { injectBundle } from '../domain/review/bundle-html.ts';
import type { NarrativeReview } from '../domain/review/narrative.ts';
import type { RunContext } from './context.ts';
import { runNpmScript, TOOL_ROOT } from './platform.ts';
import type { RunFiles } from './run-folder.ts';
import { note } from './terminal.ts';
import { VIEWER_STAMP_FILE, viewerSourceStamp } from './viewer-stamp.ts';

/**
 * The render stage: the review, its header and both sides of every reviewed
 * file, packed into the viewer shell as one `review.html`.
 */
export interface RenderDeps {
  /** The built viewer page, placeholder and all. */
  viewerShell: () => Promise<string>;
}

export const HOST_RENDER_DEPS: RenderDeps = { viewerShell: () => viewerShell(TOOL_ROOT) };

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
    throw new Error(`the report's data does not fit the viewer:\n${z.prettifyError(bundle.error)}`);
  }
  const html = injectBundle(await deps.viewerShell(), bundle.data);
  await writeFile(run.html, html);
  return Buffer.byteLength(html);
}

/**
 * `build/viewer/viewer.html` in the tool's clone, rebuilt first when it is
 * missing or its stamp no longer matches the sources.
 */
export async function viewerShell(
  root: string,
  build: (root: string) => Promise<void> = buildViewer,
): Promise<string> {
  const dir = path.join(root, 'build', 'viewer');
  const [html, stamp] = await Promise.all([
    readFile(path.join(dir, 'viewer.html'), 'utf8').catch(() => null),
    readFile(path.join(dir, VIEWER_STAMP_FILE), 'utf8').catch(() => null),
  ]);
  if (html !== null && stamp?.trim() === viewerSourceStamp(root)) return html;
  note(
    html === null
      ? '  building the report viewer (first run)'
      : '  rebuilding the report viewer (its sources changed)',
  );
  await build(root);
  return readFile(path.join(dir, 'viewer.html'), 'utf8');
}

async function buildViewer(root: string): Promise<void> {
  const result = await runNpmScript('viewer:build', root);
  if (result.exitCode !== 0) {
    const tail = result.output.trim().split('\n').slice(-15).join('\n');
    throw new Error(
      `building the report viewer failed (npm run viewer:build in ${root}):\n${tail}`,
    );
  }
}
