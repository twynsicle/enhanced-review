import { describe, expect, it } from 'vitest';
import { buildActivityBuckets } from './activity.ts';

const NOW = new Date('2026-09-07T12:00:00Z');
const daysAgo = (n: number, hours = 0) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000);

describe('buildActivityBuckets', () => {
  it('puts today in the last bucket and counts per day', () => {
    const buckets = buildActivityBuckets([daysAgo(0), daysAgo(0, 3), daysAgo(1), daysAgo(13)], NOW);
    expect(buckets).toHaveLength(14);
    expect(buckets[13]).toBe(2);
    expect(buckets[12]).toBe(1);
    expect(buckets[0]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('ignores timestamps outside the window and invalid dates', () => {
    const buckets = buildActivityBuckets([daysAgo(14), daysAgo(-1), new Date(Number.NaN)], NOW);
    expect(buckets.every((n) => n === 0)).toBe(true);
  });
});
