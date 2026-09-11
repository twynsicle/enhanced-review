import { readFile, writeFile } from 'node:fs/promises';
import { NarrativeReviewSchema, type NarrativeReview } from '../domain/review/narrative.ts';
import type { DiffHunk, DiffHunkIndex } from '../domain/review/prompt/diff-hunk-catalog.ts';
import { parseNarrativeReview } from '../domain/review/prompt/parse-narrative.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The parse stage: `raw.txt` through the hosted review's own lenient parser,
 * with hunk ids resolved against the catalog gather wrote, and the changed
 * file list attached from context rather than trusted from the model.
 */
export async function parseRun(context: RunContext, run: RunFiles): Promise<NarrativeReview> {
  let raw: string;
  try {
    raw = await readFile(run.raw, 'utf8');
  } catch {
    throw new Error(`no raw.txt in ${run.folder}; run from an earlier stage`);
  }
  const parsed = parseNarrativeReview(raw, hunkIndex(context.hunks));
  if (!parsed.ok) throw new Error(`${parsed.error} (the model's answer is in ${run.raw})`);
  const review: NarrativeReview = { ...parsed.data, files: context.files };
  await writeFile(run.review, `${JSON.stringify(review, null, 2)}\n`);
  return review;
}

export async function readReview(run: RunFiles): Promise<NarrativeReview> {
  let raw: string;
  try {
    raw = await readFile(run.review, 'utf8');
  } catch {
    throw new Error(`no review.json in ${run.folder}; run from an earlier stage`);
  }
  const parsed = NarrativeReviewSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`${run.review} is not a review: ${parsed.error.message}`);
  return parsed.data;
}

function hunkIndex(hunks: readonly DiffHunk[]): DiffHunkIndex {
  return { hunks: [...hunks], byId: Object.fromEntries(hunks.map((hunk) => [hunk.id, hunk])) };
}
