import { writeFile } from 'node:fs/promises';
import { detectLanguage } from '../domain/review/language-map.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * `--stub`: the run stage without a model (docs/local-mode D15). It writes
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
        description: `${file.filename} is ${file.status}: +${String(file.additions)} −${String(file.deletions)} across ${String(ids.length)} hunk${ids.length === 1 ? '' : 's'}.`,
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
    overviewSummary:
      'A mechanical review from er review --stub: one chapter per changed file, citing every hunk, ' +
      'so the report can be checked on a real change without running a model.',
    chapters:
      chapters.length > 0
        ? chapters
        : [
            {
              id: 'nothing-reviewed',
              title: 'Nothing to cite',
              description: 'Every changed file was left out of the review, so there are no hunks.',
              insights: [],
              diffChunks: [],
            },
          ],
  };
}
