import { describe, expect, it, vi } from 'vitest';
import { elapsed, startProgress, type ProgressDeps } from './progress.ts';

function harness() {
  const lines: string[] = [];
  let clock = 0;
  let tick: (() => void) | null = null;
  const stop = vi.fn();
  const deps: ProgressDeps = {
    print: (text) => lines.push(text),
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
    /** Move the clock on without letting the heartbeat see the gap. */
    advance: (ms: number) => {
      clock += ms;
    },
    /** Move the clock on as a running process would, heartbeat and all. */
    idle: (ms: number) => {
      for (let left = ms; left > 0; left -= 1000) {
        clock += Math.min(1000, left);
        tick?.();
      }
    },
    stopped: stop,
  };
}

describe('the run log', () => {
  it('prints a line when the run starts, stamped with elapsed time', () => {
    const h = harness();
    startProgress(h.deps);
    expect(h.last()).toContain('0s');
    expect(h.last()).toContain('starting the agent');
  });

  it('numbers each line with the turn it happened on, stamped with elapsed time', () => {
    const h = harness();
    const progress = startProgress(h.deps);

    h.advance(4_000);
    progress.activity('Read src/cli/review.ts', 1);
    expect(h.last()).toContain('[1] Read src/cli/review.ts');
    expect(h.last()).toContain('4s');

    h.advance(65_000);
    progress.activity('Grep addWorktree', 2);
    expect(h.last()).toContain('[2] Grep addWorktree');
    expect(h.last()).toContain('1m 09s');
  });

  it('gives the tools of one turn that turn’s number, not one each', () => {
    const h = harness();
    const progress = startProgress(h.deps);
    progress.activity('Read a.ts', 3);
    progress.activity('Read b.ts', 3);
    progress.activity('Read c.ts', 4);
    expect(h.lines.filter((line) => line.includes('[3]'))).toHaveLength(2);
    expect(h.lines.filter((line) => line.includes('[4]'))).toHaveLength(1);
  });

  it('keeps every turn as its own line rather than overwriting the last', () => {
    const h = harness();
    const progress = startProgress(h.deps);
    progress.activity('Read a.ts', 1);
    progress.activity('Read b.ts', 2);
    expect(h.lines.some((line) => line.includes('[1] Read a.ts'))).toBe(true);
    expect(h.lines.some((line) => line.includes('[2] Read b.ts'))).toBe(true);
  });

  it('follows the chapters as the answer streams in, ignoring insight titles', () => {
    const h = harness();
    const progress = startProgress(h.deps);

    progress.activity('Grep addWorktree', 1);
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

  it('finds a chapter that straddles a block after two arrived in one', () => {
    const h = harness();
    const progress = startProgress(h.deps);

    // Two complete titles, then a third cut off mid-way: the scan cursor has
    // to land on the end of the second, not past the start of the third.
    progress.text(
      '{"chapters":[{"id":"one","title":"One","insights":[]},' +
        '{"id":"two","title":"Two","insights":[]},{"id":"thr',
    );
    expect(h.last()).toContain('writing chapter 2: Two');

    progress.text('ee","title":"Three","insights":[]}]}');
    expect(h.last()).toContain('writing chapter 3: Three');
  });
});

describe('the heartbeat', () => {
  it('says the run is alive when a turn goes quiet, and not before', () => {
    const h = harness();
    startProgress(h.deps);

    h.idle(19_000);
    expect(h.lines).toHaveLength(1);

    h.idle(2_000);
    expect(h.last()).toContain('still working');
    expect(h.last()).toContain('20s');

    // Each beat resets the silence, so the cadence stays one line per 20s.
    h.idle(18_000);
    expect(h.lines).toHaveLength(2);
    h.idle(1_000);
    expect(h.lines).toHaveLength(3);
    expect(h.last()).toContain('40s');
  });

  it('holds off again as soon as the agent says something', () => {
    const h = harness();
    const progress = startProgress(h.deps);

    h.idle(25_000);
    expect(h.last()).toContain('still working');

    progress.activity('Read src/cli/review.ts', 1);
    h.idle(10_000);
    expect(h.last()).toContain('Read src/cli/review.ts');
  });

  it('stops redrawing when the run ends', () => {
    const h = harness();
    startProgress(h.deps).stop();
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
