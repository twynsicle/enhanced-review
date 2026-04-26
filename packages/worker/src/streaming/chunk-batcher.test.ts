import { describe, expect, it, vi } from 'vitest';

import { StreamCapExceededError, createChunkBatcher } from './chunk-batcher';

interface FakeTimer {
  id: number;
  cb: () => void;
  ms: number;
}

function makeFakeTimers() {
  const timers = new Map<number, FakeTimer>();
  let nextId = 1;
  const setTimer = (cb: () => void, ms: number) => {
    const id = nextId++;
    timers.set(id, { id, cb, ms });
    return id;
  };
  const clearTimer = (h: unknown) => {
    timers.delete(h as number);
  };
  const fire = () => {
    const all = [...timers.values()];
    timers.clear();
    for (const t of all) t.cb();
  };
  return { setTimer, clearTimer, fire, timers };
}

interface CapturedInsert {
  jobId: string;
  seq: number;
  content: string;
}

function makeFakeInsert() {
  const calls: CapturedInsert[] = [];
  const insert = vi.fn(async (jobId: string, seq: number, content: string) => {
    calls.push({ jobId, seq, content });
  });
  return { insert, calls };
}

const FAKE_SUPABASE = {} as never;

describe('createChunkBatcher', () => {
  it('flushes on time-based trigger with monotonic seq', async () => {
    const timers = makeFakeTimers();
    const { insert, calls } = makeFakeInsert();
    const batcher = createChunkBatcher({
      supabase: FAKE_SUPABASE,
      jobId: 'job-1',
      flushIntervalMs: 100,
      flushThresholdBytes: 999_999,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      insert,
    });

    batcher.onChunk('hello ');
    batcher.onChunk('world');

    // Nothing inserted yet — neither bytes nor timer threshold met.
    expect(calls).toHaveLength(0);

    timers.fire();
    await batcher.flush();
    expect(calls).toEqual([{ jobId: 'job-1', seq: 0, content: 'hello world' }]);

    batcher.onChunk('next');
    timers.fire();
    await batcher.flush();
    expect(calls).toEqual([
      { jobId: 'job-1', seq: 0, content: 'hello world' },
      { jobId: 'job-1', seq: 1, content: 'next' },
    ]);
  });

  it('flushes on byte threshold without waiting for the timer', async () => {
    const timers = makeFakeTimers();
    const { insert, calls } = makeFakeInsert();
    const batcher = createChunkBatcher({
      supabase: FAKE_SUPABASE,
      jobId: 'j',
      flushIntervalMs: 1_000_000,
      flushThresholdBytes: 4,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      insert,
    });

    batcher.onChunk('abcd');
    await batcher.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.content).toBe('abcd');
  });

  it('flush() drains buffered content even with no trigger', async () => {
    const timers = makeFakeTimers();
    const { insert, calls } = makeFakeInsert();
    const batcher = createChunkBatcher({
      supabase: FAKE_SUPABASE,
      jobId: 'j',
      flushIntervalMs: 1_000_000,
      flushThresholdBytes: 1_000_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      insert,
    });

    batcher.onChunk('tail');
    await batcher.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.content).toBe('tail');
  });

  it('flush() is idempotent', async () => {
    const timers = makeFakeTimers();
    const { insert, calls } = makeFakeInsert();
    const batcher = createChunkBatcher({
      supabase: FAKE_SUPABASE,
      jobId: 'j',
      flushIntervalMs: 1_000_000,
      flushThresholdBytes: 1_000_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      insert,
    });

    batcher.onChunk('once');
    await batcher.flush();
    await batcher.flush();
    expect(calls).toHaveLength(1);
  });

  it('throws StreamCapExceededError when row count would exceed maxChunks', async () => {
    const timers = makeFakeTimers();
    const { insert } = makeFakeInsert();
    const batcher = createChunkBatcher({
      supabase: FAKE_SUPABASE,
      jobId: 'j',
      maxChunks: 2,
      flushIntervalMs: 1_000_000,
      flushThresholdBytes: 1, // force every onChunk to flush a new row.
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      insert,
    });

    batcher.onChunk('a');
    batcher.onChunk('b');
    expect(() => batcher.onChunk('c')).toThrow(StreamCapExceededError);
    expect(batcher.getCount()).toBe(2);
  });

  it('appends to an existing buffer without bumping row count when above threshold', async () => {
    const timers = makeFakeTimers();
    const { insert, calls } = makeFakeInsert();
    const batcher = createChunkBatcher({
      supabase: FAKE_SUPABASE,
      jobId: 'j',
      maxChunks: 1,
      flushIntervalMs: 1_000_000,
      flushThresholdBytes: 1_000_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      insert,
    });

    // Cap is 1 row. Multiple onChunk calls into a single buffered row are fine.
    batcher.onChunk('x');
    batcher.onChunk('y');
    batcher.onChunk('z');
    await batcher.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.content).toBe('xyz');
  });
});
