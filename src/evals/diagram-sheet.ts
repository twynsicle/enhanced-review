import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  injectSheet,
  type ContactSheet,
  type SheetBranch,
  type SheetSample,
} from '../report/sheet/sheet-data.ts';
import { readJudgements, type JudgedOverview } from './diagram-judge.ts';
import { diagramSampleFiles, readDiagramSweep, type DiagramSweep } from './diagram-run.ts';
import {
  deserved,
  sampleFigures,
  sampleVerdict,
  scoreDiagramSweep,
  type BranchScore,
} from './diagram-score.ts';

/**
 * The contact sheet: a sweep's diagrams, or two sweeps' one band above the
 * other, on one page drawn by the report's own painters. Written into the
 * later sweep's folder, so each sample's review is a relative link away.
 */
export interface SheetDeps {
  /** Builds the sheet page and returns its HTML with the data element empty. */
  buildPage?: (root: string) => Promise<string>;
}

export async function writeContactSheet(
  folders: readonly string[],
  root: string,
  deps: SheetDeps = {},
): Promise<string> {
  if (folders.length === 0 || folders.length > 2) {
    throw new Error('a contact sheet shows one sweep, or two side by side');
  }
  const sweeps = await Promise.all(
    folders.map(async (folder) => {
      const scores = await scoreDiagramSweep(folder, root);
      return {
        folder,
        record: await readDiagramSweep(folder),
        scores,
        judged: await readJudgements(folder, scores),
      };
    }),
  );
  const out = folders.at(-1)!;
  const file =
    folders.length === 1
      ? path.join(out, 'sheet.html')
      : path.join(out, `sheet-vs-${path.basename(folders[0]!)}.html`);
  const sheet = contactSheet(sweeps, path.dirname(file));
  const page = await (deps.buildPage ?? buildSheetPage)(root);
  await writeFile(file, injectSheet(page, sheet));
  return file;
}

export function contactSheet(
  sweeps: readonly {
    folder: string;
    record: DiagramSweep;
    scores: BranchScore[];
    judged: readonly JudgedOverview[];
  }[],
  sheetDir: string,
): ContactSheet {
  const names = [...new Set(sweeps.flatMap((sweep) => sweep.record.branches))];
  const branches = names.map((name): SheetBranch => {
    const spec = sweeps.flatMap((sweep) => sweep.scores).find((score) => score.name === name)!.spec;
    return {
      name,
      title: spec.title,
      deserves: deserved(spec.expect),
      question: spec.expect.question,
      mustName: spec.expect.mustName,
      mustReach: spec.expect.mustReach,
      bands: sweeps.map((sweep) => {
        const score = sweep.scores.find((item) => item.name === name);
        return score
          ? score.samples.map((sample) =>
              sheetSample(sweep.folder, score, sample, sheetDir, sweep.judged),
            )
          : [];
      }),
    };
  });
  return {
    sweeps: sweeps.map(({ folder, record }) => ({
      stamp: path.basename(folder),
      summary: sweepSummary(record),
    })),
    branches,
  };
}

function sheetSample(
  folder: string,
  score: BranchScore,
  sample: BranchScore['samples'][number],
  sheetDir: string,
  judged: readonly JudgedOverview[],
): SheetSample {
  const run = diagramSampleFiles(folder, score.name, sample.sample).run;
  return {
    sample: sample.sample,
    href:
      sample.review === null
        ? null
        : path.relative(sheetDir, path.join(run, 'review.html')).replaceAll(path.sep, '/'),
    failure: sample.meta.failure,
    onTarget: sample.review?.onTarget ?? false,
    verdict: sampleVerdict(sample),
    figures: sampleFigures(sample, score.spec.expect.mustReach.length),
    diagrams:
      sample.review?.diagrams.map(({ where, diagram }) => ({
        where,
        diagram,
        judgements:
          where === 'overview'
            ? judged
                .filter((item) => item.branch === score.name && item.sample === sample.sample)
                .map(({ judge, parsed }) => ({
                  judge,
                  rating: parsed.judgement?.rating ?? null,
                  reason: parsed.judgement?.reason ?? parsed.problems.join('; '),
                }))
            : [],
      })) ?? [],
  };
}

function sweepSummary(record: DiagramSweep): string {
  const model = record.model ?? "er's default model";
  const effort = record.effort === null ? '' : ` at ${record.effort} effort`;
  const cost = record.costUsd === null ? '' : `, $${record.costUsd.toFixed(2)}`;
  return `${model}${effort}, ${record.diagramStyle} diagrams, ${String(record.branches.length)} branches × ${String(record.samples)} samples${cost}`;
}

/**
 * `vite.sheet.config.ts` built to `build/sheet/sheet.html` on every call: it
 * takes seconds, and a sheet is made by hand, so a stale page is never worth
 * a stamp to guard against.
 */
async function buildSheetPage(root: string): Promise<string> {
  const { build } = await import('vite');
  await build({ configFile: path.join(root, 'vite.sheet.config.ts'), logLevel: 'warn' });
  return readFile(path.join(root, 'build', 'sheet', 'sheet.html'), 'utf8');
}
