#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { EFFORTS, type Effort } from '../cli/claude-run.ts';
import { fail, line, note } from '../cli/terminal.ts';
import { DIAGRAM_CONTRIVED_DIR, listDiagramBranches } from './diagram-case.ts';
import { contriveDiagramBranch, runTests, type ContrivedBranch } from './diagram-contrive.ts';
import {
  agreement,
  formatAgreement,
  judgeRatings,
  judgeReasons,
  readUserRatings,
} from './diagram-agree.ts';
import {
  DEFAULT_JUDGES,
  formatJudged,
  overviews,
  readJudgements,
  runJudge,
} from './diagram-judge.ts';
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
  npm run eval:diagrams -- run [--branch <name>]... [--samples <n>] [--model <name>] [--effort <level>] [--parallel <n>]
                             [--diagram-style <mechanism|files>]
      a whole er review of every branch (or those named), --samples times each (3), --parallel at
      once (3), with er's default model and effort unless --model or --effort and in er's default diagram style
      (mechanism) unless --diagram-style; each run folder kept under
      evals/diagrams/results/<stamp>/, then scored. Needs ANTHROPIC_API_KEY; spends money
  npm run eval:diagrams -- score <results folder>
      what each sample drew against what its branch deserves, and the counts, again; written to
      score.txt beside the sweep
  npm run eval:diagrams -- sheet <results folder> [<later results folder>]
      every diagram of a sweep, or of two one band above the other, on one page: sheet.html in the
      (later) folder, with a good / usable / poor control under each overview and a button that
      downloads your ratings as ratings.json, to save into the sweep's folder
  npm run eval:diagrams -- judge <results folder> [--judge <model>]... [--parallel <n>]
      each judge model (${DEFAULT_JUDGES.join(' and ')} unless --judge) rates every overview of the
      sweep good, usable or poor against its branch's question and mechanisms, --parallel at once
      (4); written under judgements/ in the sweep, replacing an earlier judging. Needs
      ANTHROPIC_API_KEY; spends money
  npm run eval:diagrams -- agree <results folder>
      the judges' ratings against yours from the sweep's ratings.json, and against each other:
      agreement, kappa, and every disagreement with the judge's reason`;

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
    case 'judge':
      return judgeCommand(rest, root);
    case 'agree': {
      const [folder, ...extra] = rest;
      if (!folder || extra.length > 0) throw new Error('agree takes one results folder');
      await agreeCommand(path.resolve(folder), root);
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
      effort: { type: 'string' },
      parallel: { type: 'string', default: '3' },
      'diagram-style': { type: 'string', default: DEFAULT_DIAGRAM_STYLE },
    },
  });
  const diagramStyle = values['diagram-style'];
  if (!isDiagramStyle(diagramStyle)) {
    throw new Error(`--diagram-style takes ${DIAGRAM_STYLES.join(' or ')}; not "${diagramStyle}"`);
  }
  const effort = values.effort ?? null;
  if (effort !== null && !(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(`--effort takes ${EFFORTS.join(', ')}; not "${effort}"`);
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
    {
      root,
      model: values.model ?? null,
      effort: effort as Effort | null,
      diagramStyle,
      samples,
      branches,
      parallel,
    },
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

async function judgeCommand(argv: string[], root: string): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      judge: { type: 'string', multiple: true },
      parallel: { type: 'string', default: '4' },
    },
    allowPositionals: true,
  });
  const [folder, ...extra] = positionals;
  if (!folder || extra.length > 0) throw new Error('judge takes one results folder');
  requireApiKey();
  const judges = values.judge ?? DEFAULT_JUDGES;
  const sweep = path.resolve(folder);
  const record = await runJudge(
    {
      folder: sweep,
      work: overviews(await scoreDiagramSweep(sweep, root)),
      judges,
      parallel: positiveInteger(values.parallel, '--parallel'),
    },
    {
      onJudged: (judge, branch, sample, meta) => {
        const cost = meta.costUsd === null ? '' : `, $${meta.costUsd.toFixed(2)}`;
        note(`${judge}: ${branch} sample ${String(sample)}${cost}`);
      },
    },
  );
  if (record.costUsd !== null) note(`judged for $${record.costUsd.toFixed(2)}`);
  await scoreCommand(sweep, root);
  return 0;
}

async function agreeCommand(folder: string, root: string): Promise<void> {
  const scores = await scoreDiagramSweep(folder, root);
  const judged = await readJudgements(folder, scores);
  if (judged.length === 0) throw new Error(`${folder} has not been judged; run judge first`);
  const user = await readUserRatings(folder);
  const judges = [...new Set(judged.map((item) => item.judge))];
  const lines: string[] = [];
  for (const judge of judges) {
    const result = agreement('you', user, judge, judgeRatings(judged, judge));
    lines.push(...formatAgreement(result, judgeReasons(judged, judge)), '');
  }
  for (const [at, first] of judges.entries()) {
    for (const second of judges.slice(at + 1)) {
      lines.push(
        ...formatAgreement(
          agreement(first, judgeRatings(judged, first), second, judgeRatings(judged, second)),
        ),
        '',
      );
    }
  }
  for (const text of lines) line(text);
}

async function scoreCommand(folder: string, root: string): Promise<void> {
  const scores = await scoreDiagramSweep(folder, root);
  const judged = await readJudgements(folder, scores);
  const lines = [
    ...scores.flatMap((score) => [
      ...formatBranchScore(score),
      ...formatJudged(score.name, judged).map((text) => `  ${text}`),
      '',
    ]),
    ...formatDiagramOverall(scores),
    ...formatJudged(null, judged).map((text) => `  ${text}`),
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
