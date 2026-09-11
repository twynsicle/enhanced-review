#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { toolVersion } from './platform.ts';
import { review } from './review.ts';
import type { TargetRequest } from './targets.ts';
import { fail, line } from './terminal.ts';

/**
 * `er` — review a change from inside the repository that holds it, and write
 * a self-contained HTML report (docs/local-mode). This is the bin entry that
 * `npm link` puts on PATH.
 */
const USAGE = `Usage: er review [<pr-number> | --staged] [options]

  er review            the current branch, against its PR's base or the default branch
  er review 42         pull request #42 (via gh)
  er review --staged   the staged changes, against HEAD

Options:
  --base <ref>         compare against <ref> instead (branch and PR reviews)
  -h, --help           show this help
  -v, --version        show the version`;

class UsageError extends Error {}

function targetRequest(args: string[], flags: { staged?: boolean; base?: string }): TargetRequest {
  if (args.length > 1) throw new UsageError(`unexpected argument: ${args[1]!}`);
  const base = flags.base ?? null;
  if (flags.staged) {
    if (args.length > 0) throw new UsageError('--staged takes no PR number');
    if (base) throw new UsageError('--base does not apply to --staged');
    return { kind: 'staged' };
  }
  if (args.length === 0) return { kind: 'branch', base };
  const number = /^#?(\d+)$/.exec(args[0]!)?.[1];
  if (!number || Number(number) < 1) throw new UsageError(`not a PR number: ${args[0]!}`);
  return { kind: 'pr', number: Number(number), base };
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      staged: { type: 'boolean' },
      base: { type: 'string' },
    },
  });
  if (values.version) {
    line(toolVersion());
    return 0;
  }
  if (values.help || positionals.length === 0) {
    line(USAGE);
    return values.help ? 0 : 1;
  }
  const [command, ...args] = positionals;
  if (command !== 'review') throw new UsageError(`unknown command: ${command!}`);
  return review({ request: targetRequest(args, values), cwd: process.cwd() });
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  fail((error as Error).message);
  if (
    error instanceof UsageError ||
    (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
  ) {
    line();
    line(USAGE);
  }
  process.exitCode = 1;
}
