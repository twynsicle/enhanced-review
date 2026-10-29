#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_MODEL } from '../cli/claude-run.ts';
import { fail, line, note } from '../cli/terminal.ts';
import { caseFiles, listCases, readCase } from './skim-case.ts';
import { contriveCase, listContrived } from './contrive.ts';
import { defaultCaseName, importCase } from './skim-import.ts';
import { readRunAnswer } from './skim-review.ts';
import { readSweep, requireApiKey, runSweep, sweepFiles } from './skim-run.ts';
import { formatCaseScore, formatOverall, scoreCase, type CaseScore } from './skim-score.ts';

/**
 * `npm run eval:skims -- <command>`: the skim-tier eval, run from this
 * repository's root. Not part of the gate: a sweep spends money and the
 * model is not deterministic, so it is run by hand before a change to the
 * tiering rules is merged, and its number compared with the last one.
 */
export const USAGE = `usage:
  npm run eval:skims -- import <run-folder> [--name <case>]
      cut a case from an er run folder (its context.json, diff and review), labels seeded from the review
  npm run eval:skims -- contrive <name>... | --all
      build a case from a branch under evals/skims/contrived: a throwaway repository, a --stub review, an import
  npm run eval:skims -- run [--samples <n>] [--model <model>] [--parallel <n>] [--case <name>]...
      every case (or the ones named), <n> samples each, one SDK query per sample; needs ANTHROPIC_API_KEY
  npm run eval:skims -- score <results-folder>
      score a sweep again, against the labels as they are now
  npm run eval:skims -- score-runs <case> <run-folder>...
      score whole er review runs of the case's change, one sample each, against its labels`;

const DEFAULT_SAMPLES = 3;
const DEFAULT_PARALLEL = 3;

async function main(argv: string[], root: string): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'import':
      return importCommand(rest, root);
    case 'contrive':
      return contriveCommand(rest, root);
    case 'run':
      return runCommand(rest, root);
    case 'score':
      return scoreCommand(rest, root);
    case 'score-runs':
      return scoreRunsCommand(rest, root);
    case undefined:
    case '--help':
    case '-h':
      line(USAGE);
      return command === undefined ? 1 : 0;
    default:
      throw new Error(`unknown command ${command}`);
  }
}

async function importCommand(argv: string[], root: string): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { name: { type: 'string' } },
    allowPositionals: true,
  });
  const [runFolder] = positionals;
  if (!runFolder) throw new Error('import needs a run folder');
  const name = values.name ?? defaultCaseName(runFolder);
  const files = await importCase(runFolder, name, root);
  const { labels } = await readCase(files);
  const seeded = labels.filter((label) => label.tier === 'read' || label.tier === 'skim').length;
  line(`${files.folder}: ${String(labels.length)} hunks, ${String(seeded)} to label`);
  note(
    `edit ${path.relative(root, files.labels)}: on each row, correct the tier (read, skim or either) ` +
      'and add a category; a row without a category is not scored',
  );
  return 0;
}

async function contriveCommand(argv: string[], root: string): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { all: { type: 'boolean' } },
    allowPositionals: true,
  });
  const names = values.all ? await listContrived(root) : positionals;
  if (names.length === 0) throw new Error('contrive needs a branch name, or --all');
  for (const name of names) {
    const files = await contriveCase(name, root);
    const { labels } = await readCase(files);
    line(`${files.folder}: ${String(labels.length)} hunks`);
  }
  note('every seeded tier is read, since no model ran; label each row by hand');
  return 0;
}

async function runCommand(argv: string[], root: string): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      samples: { type: 'string' },
      model: { type: 'string' },
      parallel: { type: 'string' },
      case: { type: 'string', multiple: true },
    },
  });
  requireApiKey();
  const cases = values.case ?? (await listCases(root));
  if (cases.length === 0) throw new Error('no cases: import one first');
  const samples = positiveInt(values.samples, DEFAULT_SAMPLES, '--samples');
  const parallel = positiveInt(values.parallel, DEFAULT_PARALLEL, '--parallel');
  const model = values.model ?? DEFAULT_MODEL;
  line(`${String(cases.length)} cases × ${String(samples)} samples on ${model}`);
  const sweep = await runSweep(
    { root, model, samples, cases, parallel },
    {
      onSample: (name, sample, meta) => {
        const cost = meta.costUsd === null ? '' : `  $${meta.costUsd.toFixed(2)}`;
        const ended = meta.ended === null ? '' : `  (${meta.ended})`;
        note(
          `  ${name} ${String(sample)}/${String(samples)}  ${(meta.ms / 1000).toFixed(1)}s${cost}${ended}`,
        );
      },
    },
  );
  return scoreSweep(sweep.folder, root);
}

async function scoreCommand(argv: string[], root: string): Promise<number> {
  const [folder] = argv;
  if (!folder) throw new Error('score needs a results folder');
  return scoreSweep(folder, root);
}

async function scoreSweep(folder: string, root: string): Promise<number> {
  const sweep = sweepFiles(path.resolve(root, folder));
  const { record, answers } = await readSweep(sweep);
  const scores: CaseScore[] = [];
  for (const name of record.cases) {
    const { case: skimCase, labels } = await readCase(caseFiles(root, name));
    scores.push(scoreCase(skimCase, labels, answers.get(name)!));
  }
  line();
  for (const score of scores) {
    for (const text of formatCaseScore(score)) line(text);
    line();
  }
  for (const text of formatOverall(scores)) line(text);
  const cost = record.costUsd === null ? 'cost unknown' : `$${record.costUsd.toFixed(2)}`;
  line(`${record.model}  ·  ${cost}  ·  ${path.relative(root, sweep.folder)}`);
  await writeFile(path.join(sweep.folder, 'summary.json'), `${JSON.stringify(scores, null, 2)}\n`);
  return 0;
}

async function scoreRunsCommand(argv: string[], root: string): Promise<number> {
  const [name, ...folders] = argv;
  if (!name || folders.length === 0) {
    throw new Error('score-runs needs a case and at least one er run folder');
  }
  const { case: skimCase, labels } = await readCase(caseFiles(root, name));
  const answers = [];
  for (const folder of folders)
    answers.push(await readRunAnswer(path.resolve(root, folder), skimCase));
  line();
  for (const text of formatCaseScore(scoreCase(skimCase, labels, answers))) line(text);
  return 0;
}

function positiveInt(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`${flag} takes a whole number from 1`);
  }
  return parsed;
}

try {
  process.exitCode = await main(process.argv.slice(2), process.cwd());
} catch (error) {
  fail((error as Error).message);
  process.exitCode = 1;
}
