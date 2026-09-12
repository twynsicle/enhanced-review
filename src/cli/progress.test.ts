import { describe, expect, it, vi } from 'vitest';
import { elapsed, startProgress, type ProgressDeps } from './progress.ts';

function harness() {
  const lines: string[] = [];
  let clock = 0;
  let tick: (() => void) | null = null;
  const stop = vi.fn();
  const deps: ProgressDeps = {
    status: (text) => lines.push(text),
    clear: () => lines.push('<cleared>'),
    now: () => clock,
    every: (callback) => {
      tick = callback;
      return { stop };
    },
  };
  return {
    deps,
    lines,
    last: () => lines.at(-1) ?? '',
    advance: (ms: number) => {
      clock += ms;
      tick?.();
    },
    stopped: stop,
  };
}

describe('the live line during a model run', () => {
  it('starts showing the clock before the agent has done anything', () => {
    const h = harness();
    startProgress(h.deps);
    expect(h.last()).toContain('0s');
    h.advance(65_000);
    expect(h.last()).toContain('1m 05s');
  });

  it('shows what the agent is reading', () => {
    const h = harness();
    const progress = startProgress(h.deps);
    progress.activity('Read src/cli/review.ts');
    expect(h.last()).toContain('Read src/cli/review.ts');
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

  it('takes the line down and stops redrawing when the run ends', () => {
    const h = harness();
    startProgress(h.deps).stop();
    expect(h.last()).toBe('<cleared>');
    expect(h.stopped).toHaveBeenCalled();
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
