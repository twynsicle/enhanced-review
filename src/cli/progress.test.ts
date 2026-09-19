import { describe, expect, it } from 'vitest';
import { elapsed, startProgress, type ProgressDeps } from './progress.ts';

function harness() {
  const lines: string[] = [];
  let clock = 0;
  const deps: ProgressDeps = {
    print: (text) => lines.push(text),
    now: () => clock,
  };
  return {
    deps,
    lines,
    last: () => lines.at(-1) ?? '',
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('the run log', () => {
  it('prints a line when the run starts, stamped with elapsed time', () => {
    const h = harness();
    startProgress(h.deps);
    expect(h.last()).toContain('0s');
    expect(h.last()).toContain('starting the agent');
  });

  it('numbers each turn and stamps it with elapsed time', () => {
    const h = harness();
    const progress = startProgress(h.deps);

    h.advance(4_000);
    progress.activity('Read src/cli/review.ts');
    expect(h.last()).toContain('[1] Read src/cli/review.ts');
    expect(h.last()).toContain('4s');

    h.advance(65_000);
    progress.activity('Grep addWorktree');
    expect(h.last()).toContain('[2] Grep addWorktree');
    expect(h.last()).toContain('1m 09s');
  });

  it('keeps every turn as its own line rather than overwriting the last', () => {
    const h = harness();
    const progress = startProgress(h.deps);
    progress.activity('Read a.ts');
    progress.activity('Read b.ts');
    expect(h.lines.some((line) => line.includes('[1] Read a.ts'))).toBe(true);
    expect(h.lines.some((line) => line.includes('[2] Read b.ts'))).toBe(true);
  });

  it('follows the chapters as the answer streams in, ignoring insight titles', () => {
    const h = harness();
    const progress = startProgress(h.deps);

    progress.activity('Grep addWorktree');
    progress.text('{"chapters":[{"id":"worktrees","title":"PR wo');
    expect(h.last()).toContain('Grep addWorktree');

    // The rest of the first chapter title arrives in the next block.
    progress.text(
      'rktrees","description":"...","insights":[{"type":"context","title":"Not a chapter"}]},',
    );
    expect(h.last()).toContain('writing chapter 1: PR worktrees');

    progress.text('{"id":"the-gate","title":"Bash gate","insights":[]}]}');
    expect(h.last()).toContain('writing chapter 2: Bash gate');
  });
});

describe('elapsed', () => {
  it('reads as a stopwatch', () => {
    expect(elapsed(0)).toBe('0s');
    expect(elapsed(9_400)).toBe('9s');
    expect(elapsed(60_000)).toBe('1m 00s');
    expect(elapsed(3_725_000)).toBe('62m 05s');
  });
});
