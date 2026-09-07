import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from './time-ago.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');

function minutesAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60_000).toISOString();
}

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(timeAgo('not a date')).toBe('not a date');
  });

  it('formats sub-minute deltas as "just now"', () => {
    expect(timeAgo(minutesAgo(0))).toBe('just now');
  });

  it('formats minutes, hours, days, months and years', () => {
    expect(timeAgo(minutesAgo(5))).toBe('5m ago');
    expect(timeAgo(minutesAgo(3 * 60))).toBe('3h ago');
    expect(timeAgo(minutesAgo(2 * 24 * 60))).toBe('2d ago');
    expect(timeAgo(minutesAgo(45 * 24 * 60))).toBe('2mo ago');
    expect(timeAgo(minutesAgo(400 * 24 * 60))).toBe('1y ago');
  });
});
