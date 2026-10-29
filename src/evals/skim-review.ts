import { access, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readContext } from '../cli/context.ts';
import { runFiles } from '../cli/run-folder.ts';
import { HunkTierSchema } from '../review/narrative.ts';
import type { DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import type { ParsedAnswer, TierAnswer } from './skim-answer.ts';
import type { SkimCase } from './skim-case.ts';

/**
 * The tiers a whole `er review` gave, read from its run folder. A sweep asks
 * for tiers alone; a review decides them while it also writes chapters, so
 * scoring real runs against the same labels is what says whether a rule
 * that helps the sweep holds where a reader sees it.
 */

/**
 * The part of a review read here: which hunks its chapters cite, at what
 * tier. Only that, so the rest of the review's shape can change freely.
 */
const ReviewTiersSchema = z.object({
  chapters: z.array(
    z.object({
      diffChunks: z.array(
        z.object({
          hunks: z.array(
            z.object({
              id: z.string(),
              tier: HunkTierSchema,
              skimReason: z.string().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type ReviewTiers = z.infer<typeof ReviewTiersSchema>;

/** The review.json at `file`, or null when the run never reached one. */
export async function readReviewTiers(file: string): Promise<ReviewTiers | null> {
  try {
    await access(file);
  } catch {
    return null;
  }
  const parsed = ReviewTiersSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${file} has no chapters to read tiers from: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Each cited hunk's tier, `read` winning when chapters disagree, as the
 * review's parser merges them for the reader.
 */
export function citedTiers(review: ReviewTiers): Map<string, TierAnswer> {
  const cited = new Map<string, TierAnswer>();
  for (const chapter of review.chapters) {
    for (const chunk of chapter.diffChunks) {
      for (const hunk of chunk.hunks) {
        const earlier = cited.get(hunk.id);
        if (earlier?.tier === 'read') continue;
        if (hunk.tier === 'read' || !earlier) {
          cited.set(hunk.id, {
            id: hunk.id,
            tier: hunk.tier,
            ...(hunk.skimReason ? { skimReason: hunk.skimReason } : {}),
          });
        }
      }
    }
  }
  return cited;
}

/** An er run folder as one sample of `skimCase`. */
export async function readRunAnswer(runFolder: string, skimCase: SkimCase): Promise<ParsedAnswer> {
  const run = runFiles(runFolder);
  const context = await readContext(run);
  const review = await readReviewTiers(run.review);
  if (!review) throw new Error(`${runFolder} has no review.json: the run did not finish`);
  return runAnswer(skimCase, context.hunks, review, runFolder);
}

type CatalogHunk = Pick<DiffHunk, 'id' | 'filename' | 'header'>;

/**
 * A run's tiers as one sample, refused unless the run numbered the same
 * hunks the case labels: an id names a hunk only within one catalog, and a
 * run cut with another split, or after the branch moved, would be scored
 * against labels for other lines. `runFolder` only names the run in the error.
 */
export function runAnswer(
  skimCase: SkimCase,
  hunks: readonly CatalogHunk[],
  review: ReviewTiers,
  runFolder: string,
): ParsedAnswer {
  const mismatch = catalogMismatch(skimCase, hunks);
  if (mismatch) {
    throw new Error(`${runFolder} did not number the hunks ${skimCase.name} labels: ${mismatch}`);
  }
  return { tiers: citedTiers(review), problems: [] };
}

function catalogMismatch(skimCase: SkimCase, hunks: readonly CatalogHunk[]): string | null {
  if (hunks.length !== skimCase.hunks.length) {
    return `${String(hunks.length)} hunks where the case has ${String(skimCase.hunks.length)}`;
  }
  for (const [index, hunk] of hunks.entries()) {
    const expected = skimCase.hunks[index]!;
    if (
      hunk.id !== expected.id ||
      hunk.filename !== expected.filename ||
      hunk.header !== expected.header
    ) {
      return `${hunk.id} is ${hunk.filename} ${hunk.header}, where the case has ${expected.id} ${expected.filename} ${expected.header}`;
    }
  }
  return null;
}
