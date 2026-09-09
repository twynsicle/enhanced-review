import { describe, expect, it } from 'vitest';
import { isJobPollResponse, lastSeq, mergeChunks } from './jobs-api';

describe('mergeChunks', () => {
  it('appends new chunks in seq order and drops duplicates', () => {
    const merged = mergeChunks(
      [
        { seq: 0, content: 'a' },
        { seq: 1, content: 'b' },
      ],
      [
        { seq: 3, content: 'd' },
        { seq: 1, content: 'b' },
        { seq: 2, content: 'c' },
      ],
    );
    expect(merged.map((c) => c.content).join('')).toBe('abcd');
  });

  it('returns the same array when nothing arrived', () => {
    const chunks = [{ seq: 0, content: 'a' }];
    expect(mergeChunks(chunks, [])).toBe(chunks);
  });
});

describe('lastSeq', () => {
  it('is -1 for no chunks and the last seq otherwise', () => {
    expect(lastSeq([])).toBe(-1);
    expect(
      lastSeq([
        { seq: 0, content: '' },
        { seq: 4, content: '' },
      ]),
    ).toBe(4);
  });
});

describe('isJobPollResponse', () => {
  it('accepts the resource route body and rejects a login page', () => {
    expect(isJobPollResponse({ job: { id: 'x' }, chunks: [] })).toBe(true);
    expect(isJobPollResponse('<!doctype html>')).toBe(false);
    expect(isJobPollResponse({ job: null, chunks: [] })).toBe(false);
  });
});
