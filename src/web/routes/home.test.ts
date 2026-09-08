// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewJob } from '@/domain/jobs/jobs.server';

const jobs = {
  listJobs: vi.fn<(options: { limit: number }) => Promise<ReviewJob[]>>(),
  listRecentActivity: vi.fn<() => Promise<Date[]>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id })),
};
vi.mock('@/domain/jobs/jobs.server', () => jobs);

const { loader } = await import('./home');

beforeEach(() => {
  vi.clearAllMocks();
  jobs.listJobs.mockResolvedValue([{ id: 'a' } as ReviewJob, { id: 'b' } as ReviewJob]);
  jobs.listRecentActivity.mockResolvedValue([new Date(), new Date(Date.now() - 86_400_000)]);
});

describe('/ loader', () => {
  it('returns the five newest jobs and 14 activity buckets', async () => {
    const result = await loader();
    expect(jobs.listJobs).toHaveBeenCalledWith({ limit: 5 });
    expect(result.recent).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.activity).toHaveLength(14);
    expect(result.activity[13]).toBe(1);
    expect(result.activity[12]).toBe(1);
  });
});
