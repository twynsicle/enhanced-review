#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fail, line, note } from '../cli/terminal.ts';
import { DIAGRAM_CONTRIVED_DIR, listDiagramBranches } from './diagram-case.ts';
import { contriveDiagramBranch, runTests, type ContrivedBranch } from './diagram-contrive.ts';

/**
 * `npm run eval:diagrams -- <command>`: the diagram eval, run from this
 * repository's root. Not part of the gate: a sweep spends money and the model
 * is not deterministic.
 */
export const USAGE = `usage:
  npm run eval:diagrams -- contrive <name>... | --all
      stand each branch under evals/diagrams/contrived up as a throwaway repository, run the order
      service's tests on it and a --stub review, and report the change's size; nothing is kept`;

async function main(argv: string[], root: string): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'contrive':
      return contriveCommand(rest, root);
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
