// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = { pingDb: vi.fn<() => Promise<boolean>>() };
const jobs = {
  countJobsByStatus: vi.fn<() => Promise<number>>(),
  oldestPendingCreatedAt: vi.fn<() => Promise<Date | null>>(),
  countErrorsSince: vi.fn<() => Promise<number>>(),
};
vi.mock('@/db/client', () => client);
vi.mock('@/db/review-jobs', () => jobs);

const { loader } = await import('./health');

async function body() {
  const res = await loader();
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  client.pingDb.mockResolvedValue(true);
  jobs.countJobsByStatus.mockResolvedValue(3);
  jobs.oldestPendingCreatedAt.mockResolvedValue(new Date(Date.now() - 30_000));
  jobs.countErrorsSince.mockResolvedValue(1);
});

describe('GET /api/health', () => {
  it('returns ok=true with the queue snapshot', async () => {
    const json = await body();
    expect(json).toMatchObject({ ok: true, db: 'ok', queueDepth: 3, errorsLast24h: 1 });
    expect(json['oldestPendingAgeSec']).toBeGreaterThanOrEqual(29);
    expect(json['oldestPendingAgeSec']).toBeLessThan(60);
    expect(jobs.countJobsByStatus).toHaveBeenCalledWith('pending');
  });

  it('reports null oldestPendingAgeSec when nothing is pending', async () => {
    jobs.countJobsByStatus.mockResolvedValue(0);
    jobs.oldestPendingCreatedAt.mockResolvedValue(null);
    const json = await body();
    expect(json['queueDepth']).toBe(0);
    expect(json['oldestPendingAgeSec']).toBeNull();
  });

  it('stays 200 with nulls and ok=false when a metric query fails', async () => {
    client.pingDb.mockResolvedValue(false);
    jobs.countErrorsSince.mockRejectedValue(new Error('db down'));
    const json = await body();
    expect(json).toMatchObject({ ok: false, db: 'error', queueDepth: 3, errorsLast24h: null });
  });
});
