#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { fail, line, note } from '../cli/terminal.ts';
import { DIAGRAM_CONTRIVED_DIR, listDiagramBranches } from './diagram-case.ts';
import { contriveDiagramBranch, runTests, type ContrivedBranch } from './diagram-contrive.ts';
import { runDiagramSweep } from './diagram-run.ts';
import { formatBranchScore, formatDiagramOverall, scoreDiagramSweep } from './diagram-score.ts';
import { writeContactSheet } from './diagram-sheet.ts';
import { requireApiKey } from './skim-run.ts';
import {
  DEFAULT_DIAGRAM_STYLE,
  DIAGRAM_STYLES,
  isDiagramStyle,
} from '../review/prompt/diagram-styles.ts';

/**
 * `npm run eval:diagrams -- <command>`: the diagram eval, run from this
 * repository's root. Not part of the gate: a sweep spends money and the model
 * is not deterministic.
 */
export const USAGE = `usage:
  npm run eval:diagrams -- contrive <name>... | --all
      stand each branch under evals/diagrams/contrived up as a throwaway repository, run the order
      service's tests on it and a --stub review, and report the change's size; nothing is kept
  npm run eval:diagrams -- run [--branch <name>]... [--samples <n>] [--model <name>] [--parallel <n>]
                             [--diagram-style <mechanism|files>]
      a whole er review of every branch (or those named), --samples times each (3), --parallel at
      once (3), with er's default model unless --model and in er's default diagram style
      (mechanism) unless --diagram-style; each run folder kept under
      evals/diagrams/results/<stamp>/, then scored. Needs ANTHROPIC_API_KEY; spends money
  npm run eval:diagrams -- score <results folder>
      what each sample drew against what its branch deserves, and the counts, again; written to
      score.txt beside the sweep
  npm run eval:diagrams -- sheet <results folder> [<later results folder>]
      every diagram of a sweep, or of two one band above the other, on one page: sheet.html in the
      (later) folder`;

async function main(argv: string[], root: string): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'contrive':
      return contriveCommand(rest, root);
    case 'run':
      return runCommand(rest, root);
    case 'score': {
      const [folder, ...extra] = rest;
      if (!folder || extra.length > 0) throw new Error('score takes one results folder');
      await scoreCommand(path.resolve(folder), root);
      return 0;
    }
    case 'sheet': {
      if (rest.length === 0) throw new Error('sheet takes one results folder, or two');
      line(
        await writeContactSheet(
          rest.map((folder) => path.resolve(folder)),
          root,
        ),
      );
      return 0;
    }
    case undefined:
    case '--help':
    case '-h':
      line(USAGE);
      return command === undefined ? 1 : 0;
    default:
      throw new Error(`unknown command ${command}`);
  }
}

async function contriveCommand(argv: string[], root: string): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { all: { type: 'boolean' } },
    allowPositionals: true,
  });
  const names = values.all ? await listDiagramBranches(root) : positionals;
  if (names.length === 0) throw new Error('contrive needs a branch name, or --all');
  await runTests(path.join(root, DIAGRAM_CONTRIVED_DIR, 'base'));
  note('base: tests passed');
  for (const name of names) line(describe(await contriveDiagramBranch(name, root)));
  return 0;
}

async function runCommand(argv: string[], root: string): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      branch: { type: 'string', multiple: true },
      samples: { type: 'string', default: '3' },
      model: { type: 'string' },
      parallel: { type: 'string', default: '3' },
      'diagram-style': { type: 'string', default: DEFAULT_DIAGRAM_STYLE },
    },
  });
  const diagramStyle = values['diagram-style'];
  if (!isDiagramStyle(diagramStyle)) {
    throw new Error(`--diagram-style takes ${DIAGRAM_STYLES.join(' or ')}; not "${diagramStyle}"`);
  }
  requireApiKey();
  const samples = positiveInteger(values.samples, '--samples');
  const parallel = positiveInteger(values.parallel, '--parallel');
  const branches = values.branch ?? (await listDiagramBranches(root));
  const known = await listDiagramBranches(root);
  const unknown = branches.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`no such branch: ${unknown.join(', ')}`);
  note(
    `${String(branches.length * samples)} reviews in ${diagramStyle} style: ${String(branches.length)} branches × ${String(samples)} samples, ${String(parallel)} at once`,
  );
  const folder = await runDiagramSweep(
    { root, model: values.model ?? null, diagramStyle, samples, branches, parallel },
    {
      onSample: (branch, sample, meta) => {
        const cost = meta.costUsd === null ? '' : `, $${meta.costUsd.toFixed(2)}`;
        const how =
          meta.failure === null ? `${String(Math.round(meta.ms / 1000))}s${cost}` : 'FAILED';
        note(`${branch} sample ${String(sample)}: ${how}`);
      },
    },
  );
  line(folder);
  await scoreCommand(folder, root);
  return 0;
}

async function scoreCommand(folder: string, root: string): Promise<void> {
  const scores = await scoreDiagramSweep(folder, root);
  const lines = [
    ...scores.flatMap((score) => [...formatBranchScore(score), '']),
    ...formatDiagramOverall(scores),
  ];
  for (const text of lines) line(text);
  await writeFile(path.join(folder, 'score.txt'), `${lines.join('\n')}\n`);
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${flag} takes a whole number above 0`);
  return parsed;
}

function describe({ name, spec, size }: ContrivedBranch): string {
  const overview = spec.expect.overview ? spec.expect.overview.kinds.join('|') : 'none';
  const { min, max } = spec.expect.chapterDiagrams;
  const chapters = max === 0 ? 'none' : `${String(min)}–${String(max)}`;
  return (
    `${name}: ${String(size.files)} files, ${String(size.hunks)} hunks, ` +
    `+${String(size.added)} −${String(size.removed)}, tests passed` +
    `  ·  deserves overview ${overview}, chapter diagrams ${chapters}`
  );
}

try {
  process.exitCode = await main(process.argv.slice(2), process.cwd());
} catch (error) {
  fail((error as Error).message);
  process.exitCode = 1;
}
