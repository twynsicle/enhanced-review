import { parseArgs } from 'node:util';
import { DEFAULT_MAX_TURNS, DEFAULT_MODEL, DEFAULT_TIMEOUT_MINUTES } from './claude-run.ts';
import { reaches, RESUMABLE_STAGES, type ReviewOptions } from './review.ts';
import { reviewerInstructions } from './reviewer-instructions.ts';
import { OVERVIEW_STYLES, type OverviewStyle, type OverviewStyles } from '../review/narrative.ts';
import { DEFAULT_OVERVIEW_STYLE, isOverviewStyle } from '../review/prompt/overview-styles.ts';
import { DEFAULT_SPLIT_LINES } from '../review/prompt/split-hunks.ts';
import type { TargetRequest } from './targets.ts';

export const USAGE = `Usage: er review [<pr-number> | --staged] [options]

  er review            the current branch, against its PR's base or the default branch
  er review 42         pull request #42 (via gh)
  er review --staged   the staged changes, against HEAD

Options:
  --base <ref>         compare against <ref> instead (branch and PR reviews)
  --model <name>       review with <name> (default: ${DEFAULT_MODEL})
  --max-turns <n>      let the model take at most <n> turns (default: ${String(DEFAULT_MAX_TURNS)})
  --timeout <minutes>  give up on the model run after <minutes> (default: ${String(DEFAULT_TIMEOUT_MINUTES)})
  --instructions <text>
                       add your own guidance to the prompt: what to focus on or explain
  --instructions-file <path>
                       the same, read from a file
  --overview-style <names>
                       write what follows the overview's lede and each chapter's headline as:
                       ${OVERVIEW_STYLES.join(', ')} (default: ${DEFAULT_OVERVIEW_STYLE});
                       several, comma-separated, or all, to switch between in the report
  --split-hunks <lines>
                       split a hunk of more changed lines than this into parts of about this
                       size, at declaration boundaries; 0 keeps git's hunks (default: ${String(DEFAULT_SPLIT_LINES)})
  --stub               write a mechanical review instead of running a model
  --from <stage>       resume the newest run for this target at prompt, run, parse or render
  --no-open            write the report without opening it
  --keep-worktree      leave a PR review's temporary worktree in place
  --allow-large        run the model on a change past the size er otherwise refuses
  -h, --help           show this help
  -v, --version        show the version`;

/** A mistake in the command line, which the bin answers with the usage. */
export class UsageError extends Error {}

export type Command =
  | { kind: 'version' }
  | { kind: 'help'; exitCode: number }
  | { kind: 'review'; options: ReviewOptions };

/** `er`'s arguments as what to do, every flag checked before anything runs. */
export function parseCommand(argv: string[], cwd: string): Command {
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
      instructions: { type: 'string' },
      'instructions-file': { type: 'string' },
      'overview-style': { type: 'string' },
      'split-hunks': { type: 'string' },
    },
  });
  if (values.version) return { kind: 'version' };
  if (values.help || positionals.length === 0) {
    return { kind: 'help', exitCode: values.help ? 0 : 1 };
  }
  const [command, ...args] = positionals;
  if (command !== 'review') throw new UsageError(`unknown command: ${command!}`);
  const from = resumeStage(values.from);
  if (values['allow-large'] && (values.stub || !reaches(from, 'run'))) {
    throw new UsageError('--allow-large applies only to a run of the model');
  }
  let instructions;
  try {
    instructions = reviewerInstructions(values.instructions, values['instructions-file']);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (instructions !== null && !reaches(from, 'prompt')) {
    throw new UsageError(
      `--from ${from} reuses the prompt already written, so it cannot take new instructions; use --from prompt`,
    );
  }
  const overviewStyles = overviewStylesFlag(values['overview-style']);
  if (values['overview-style'] !== undefined && !reaches(from, 'prompt')) {
    throw new UsageError(
      `--from ${from} reuses the prompt already written, so it cannot take a new overview style; use --from prompt`,
    );
  }
  if (values['split-hunks'] !== undefined && from !== null) {
    throw new UsageError(
      `--from ${from} reuses the hunks the last run numbered, so it cannot split them again; run without --from`,
    );
  }
  return {
    kind: 'review',
    options: {
      request: targetRequest(args, values),
      cwd,
      stub: values.stub ?? false,
      model: values.model ?? DEFAULT_MODEL,
      maxTurns: positiveNumber(values['max-turns'], '--max-turns', DEFAULT_MAX_TURNS),
      timeoutMs: positiveNumber(values.timeout, '--timeout', DEFAULT_TIMEOUT_MINUTES) * 60_000,
      from,
      open: !values['no-open'],
      keepWorktree: values['keep-worktree'] ?? false,
      allowLarge: values['allow-large'] ?? false,
      instructions,
      splitLines: lineCount(values['split-hunks'], '--split-hunks', DEFAULT_SPLIT_LINES),
      overviewStyles,
    },
  };
}

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

/** The styles named, in the order named, each once; `all` is every style. */
function overviewStylesFlag(value: string | undefined): OverviewStyles {
  if (value === undefined) return [DEFAULT_OVERVIEW_STYLE];
  if (value.trim() === 'all') return [...OVERVIEW_STYLES];
  const styles: OverviewStyle[] = [];
  for (const name of value.split(',').map((part) => part.trim())) {
    if (!isOverviewStyle(name)) {
      throw new UsageError(
        `--overview-style takes all, or one or more of: ${OVERVIEW_STYLES.join(', ')}; not "${name}"`,
      );
    }
    if (!styles.includes(name)) styles.push(name);
  }
  return [styles[0]!, ...styles.slice(1)];
}

/** A flag that must be a whole number of lines, zero included. */
function lineCount(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || value.trim() === '') {
    throw new UsageError(`${flag} takes a whole number of lines, 0 or more, not ${value}`);
  }
  return parsed;
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
