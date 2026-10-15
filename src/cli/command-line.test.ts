import { describe, expect, it } from 'vitest';
import { OVERVIEW_STYLES } from '../review/prompt/overview-styles.ts';
import { type Command, parseCommand, USAGE, UsageError } from './command-line.ts';

function reviewOptions(argv: string[]) {
  const command: Command = parseCommand(['review', ...argv], 'C:/repos/widgets');
  if (command.kind !== 'review') throw new Error(`expected a review, got ${command.kind}`);
  return command.options;
}

describe('the command line', () => {
  it('reviews the current branch, in the narrative style, when nothing else is asked for', () => {
    const options = reviewOptions([]);
    expect(options.request).toEqual({ kind: 'branch', base: null });
    expect(options.cwd).toBe('C:/repos/widgets');
    expect(options.overviewStyle).toBe('narrative');
  });

  it('takes each overview style by name', () => {
    for (const style of OVERVIEW_STYLES) {
      expect(reviewOptions(['--overview-style', style]).overviewStyle).toBe(style);
    }
  });

  it('refuses a style it does not know, naming the ones it does', () => {
    expect(() => reviewOptions(['--overview-style', 'haiku'])).toThrow(UsageError);
    expect(() => reviewOptions(['--overview-style', 'haiku'])).toThrow(
      '--overview-style takes one of: narrative, before-after, five-whys, plain, tldr',
    );
  });

  it('refuses a style with a --from that writes no new prompt', () => {
    for (const from of ['run', 'parse', 'render']) {
      expect(() => reviewOptions(['--from', from, '--overview-style', 'tldr'])).toThrow(
        `--from ${from} reuses the prompt already written, so it cannot take a new overview style; use --from prompt`,
      );
    }
    expect(reviewOptions(['--from', 'prompt', '--overview-style', 'tldr'])).toMatchObject({
      from: 'prompt',
      overviewStyle: 'tldr',
    });
  });

  it('lists every style in the usage', () => {
    expect(USAGE).toContain(`${OVERVIEW_STYLES.join(', ')} (default: narrative)`);
  });

  it('still refuses new instructions and a new split with a --from that cannot use them', () => {
    expect(() => reviewOptions(['--from', 'run', '--instructions', 'Look at retries.'])).toThrow(
      /cannot take new instructions/,
    );
    expect(() => reviewOptions(['--from', 'prompt', '--split-hunks', '5'])).toThrow(
      /cannot split them again/,
    );
  });

  it('answers help and version before anything else', () => {
    expect(parseCommand(['--version'], '.')).toEqual({ kind: 'version' });
    expect(parseCommand(['review', '--help'], '.')).toEqual({ kind: 'help', exitCode: 0 });
    expect(parseCommand([], '.')).toEqual({ kind: 'help', exitCode: 1 });
  });
});
