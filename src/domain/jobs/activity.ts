/**
 * Day buckets for the home page sparkline: `days` buckets ending today, the
 * last one being today. Timestamps outside the window are ignored.
 */
export function buildActivityBuckets(
  createdAt: readonly Date[],
  now: Date = new Date(),
  days = 14,
): number[] {
  const buckets = Array.from({ length: days }, () => 0);
  const dayMs = 24 * 60 * 60 * 1000;
  for (const date of createdAt) {
    const t = date.getTime();
    if (Number.isNaN(t)) continue;
    const daysAgo = Math.floor((now.getTime() - t) / dayMs);
    if (daysAgo < 0 || daysAgo >= days) continue;
    buckets[days - 1 - daysAgo] += 1;
  }
  return buckets;
}
