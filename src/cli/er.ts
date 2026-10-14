#!/usr/bin/env node
import { parseCommand, UsageError, USAGE } from './command-line.ts';
import { runInterruptCleanups } from './interrupts.ts';
import { toolVersion } from './platform.ts';
import { review } from './review.ts';
import { fail, line } from './terminal.ts';

/**
 * `er` — review a change from inside the repository that holds it, and write
 * the result as one HTML file. This is the bin entry that
 * `npm link` puts on PATH.
 */
async function main(argv: string[]): Promise<number> {
  const command = parseCommand(argv, process.cwd());
  if (command.kind === 'version') {
    line(toolVersion());
    return 0;
  }
  if (command.kind === 'help') {
    line(USAGE);
    return command.exitCode;
  }
  return review(command.options);
}

// The only signal handlers in er: run what the stages registered (a PR
// worktree's removal, say), then exit the way a shell expects.
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.on(signal, () => {
    runInterruptCleanups();
    fail('interrupted');
    process.exit(code);
  });
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
