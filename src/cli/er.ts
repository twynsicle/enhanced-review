#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_MAX_TURNS, DEFAULT_MODEL, DEFAULT_TIMEOUT_MINUTES } from './claude-run.ts';
import { toolVersion } from './platform.ts';
import { runInterruptCleanups } from './interrupts.ts';
import { RESUMABLE_STAGES, review, type ReviewOptions } from './review.ts';
import type { TargetRequest } from './targets.ts';
import { fail, line } from './terminal.ts';

/**
 * `er` — review a change from inside the repository that holds it, and write
 * the result as one HTML file. This is the bin entry that
 * `npm link` puts on PATH.
 */
const USAGE = `Usage: er review [<pr-number> | --staged] [options]

  er review            the current branch, against its PR's base or the default branch
  er review 42         pull request #42 (via gh)
  er review --staged   the staged changes, against HEAD

Options:
  --base <ref>         compare against <ref> instead (branch and PR reviews)
  --model <name>       review with <name> (default: ${DEFAULT_MODEL})
  --max-turns <n>      let the model take at most <n> turns (default: ${String(DEFAULT_MAX_TURNS)})
  --timeout <minutes>  give up on the model run after <minutes> (default: ${String(DEFAULT_TIMEOUT_MINUTES)})
  --stub               write a mechanical review instead of running a model
  --from <stage>       resume the newest run for this target at prompt, run, parse or render
  --no-open            write the report without opening it
  --keep-worktree      leave a PR review's temporary worktree in place
  --allow-large        run the model on a change past the size er otherwise refuses
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
      model: { type: 'string' },
      'max-turns': { type: 'string' },
      timeout: { type: 'string' },
      stub: { type: 'boolean' },
      from: { type: 'string' },
      'no-open': { type: 'boolean' },
      'keep-worktree': { type: 'boolean' },
      'allow-large': { type: 'boolean' },
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
  const from = resumeStage(values.from);
  if (values['allow-large'] && (values.stub || from === 'parse' || from === 'render')) {
    throw new UsageError('--allow-large applies only to a run of the model');
  }
  return review({
    request: targetRequest(args, values),
    cwd: process.cwd(),
    stub: values.stub ?? false,
    model: values.model ?? DEFAULT_MODEL,
    maxTurns: positiveNumber(values['max-turns'], '--max-turns', DEFAULT_MAX_TURNS),
    timeoutMs: positiveNumber(values.timeout, '--timeout', DEFAULT_TIMEOUT_MINUTES) * 60_000,
    from,
    open: !values['no-open'],
    keepWorktree: values['keep-worktree'] ?? false,
    allowLarge: values['allow-large'] ?? false,
  });
}

/** A flag that must be a number greater than zero; minutes or turns. */
function positiveNumber(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new UsageError(`${flag} takes a number greater than zero, not ${value}`);
  }
  return parsed;
}

function resumeStage(from: string | undefined): ReviewOptions['from'] {
  if (from === undefined) return null;
  const stage = RESUMABLE_STAGES.find((name) => name === from);
  if (!stage) throw new UsageError(`--from takes one of: ${RESUMABLE_STAGES.join(', ')}`);
  return stage;
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
