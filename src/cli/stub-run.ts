import { writeFile } from 'node:fs/promises';
import { plural } from '../common/plural.ts';
import { detectLanguage } from '../domain/review/language-map.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The event log of a stub run: one clean result, so the parse stage reads how
 * this run ended rather than how some earlier one did. It is written every
 * time, overwriting any real run's log in the same folder, because `--from run
 * --stub` replaces the answer and the log has to describe the same run the
 * answer came from.
 *
 * The field names are the real result event's, so `parse.ts` reads both with
 * the one schema.
 */
const STUB_RESULT = JSON.stringify({
  ms: 0,
  type: 'result',
  subtype: 'success',
  isError: false,
  turns: 0,
  costUsd: null,
  usage: null,
});

/**
 * `--stub`: the run stage without a model. It writes
 * `raw.txt` in the shape the model answers in, one chapter per reviewed file
 * citing every one of its hunks, so parse and render run on a real change
 * for free. The prose says plainly that nothing read the code.
 */
export async function writeStubRun(context: RunContext, run: RunFiles): Promise<number> {
  const review = stubReview(context);
  await writeFile(
    run.raw,
    `<narrative_review>\n${JSON.stringify(review, null, 2)}\n</narrative_review>\n`,
  );
  await writeFile(run.events, `${STUB_RESULT}\n`);
  return review.chapters.length;
}

export function stubReview({ meta, files, hunks }: RunContext) {
  const idsByFile = new Map<string, string[]>();
  for (const hunk of hunks) {
    idsByFile.set(hunk.filename, [...(idsByFile.get(hunk.filename) ?? []), hunk.id]);
  }
  const chapters = files
    .filter((file) => !file.skipped && idsByFile.has(file.filename))
    .map((file, index) => {
      const ids = idsByFile.get(file.filename)!;
      return {
        id: `file-${String(index + 1)}`,
        title: file.filename.split('/').at(-1)!,
        description: {
          lede: `${file.filename} is ${file.status}: +${String(file.additions)} −${String(file.deletions)} across ${plural(ids.length, 'hunk')}.`,
        },
        insights: [
          {
            type: 'context',
            title: 'Placed here by the stub run',
            text: 'er review --stub gives every changed file its own chapter; no model read this code.',
          },
        ],
        diffChunks: [
          { filename: file.filename, language: detectLanguage(file.filename), hunkIds: ids },
        ],
      };
    });
  return {
    prTitle: meta.title,
    overviewSummary: {
      lede: 'A mechanical review: one chapter per changed file, citing every hunk.',
      body:
        'From `er review --stub`, so the report can be checked against a real change ' +
        'without running a model.',
    },
    chapters:
      chapters.length > 0
        ? chapters
        : [
            {
              id: 'nothing-reviewed',
              title: 'Nothing to cite',
              description: {
                lede: 'Every changed file was left out of the review, so there are no hunks.',
              },
              insights: [],
              diffChunks: [],
            },
          ],
  };
}
