#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { toolVersion } from './platform.ts';
import { fail, line } from './terminal.ts';

/**
 * `er` — review a change from inside the repository that holds it, and write
 * a self-contained HTML report (docs/local-mode). This is the bin entry that
 * `npm link` puts on PATH.
 */
const USAGE = `Usage: er review [<pr-number> | --staged] [options]

  er review            the current branch, against the default branch
  er review 42         pull request #42 (via gh)
  er review --staged   the staged changes, against HEAD

Options:
  -h, --help           show this help
  -v, --version        show the version`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
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
  fail(`unknown command: ${positionals.join(' ')}`);
  line(USAGE);
  return 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  fail((error as Error).message);
  process.exitCode = 1;
}
