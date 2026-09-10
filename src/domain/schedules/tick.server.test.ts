import { describe, expect, it, vi } from 'vitest';
import type { ReviewScheduleRecord } from '../../db/review-schedules.ts';
import { GithubAuthError } from '../github/client.server.ts';
import { JobInFlightError } from '../jobs/errors.ts';
import { formatScheduleError, runSchedulerTick, type SchedulerTickDeps } from './tick.server.ts';

const NOW = new Date('2026-05-04T09:00:30.000Z');
const DUE = new Date('2026-05-04T09:00:00.000Z');

const TARGET = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  headSha: 'head',
  baseSha: 'base',
  title: 'Add widgets',
};

function schedule(overrides: Partial<ReviewScheduleRecord> = {}): ReviewScheduleRecord {
  return {
    id: 's1',
    userId: 'u1',
    githubLogin: 'alice',
    target: TARGET,
    targetKey: 'pr:acme/widgets#12',
    cadence: 'daily',
    timeZone: 'UTC',
    hourOfDay: 9,
    status: 'running',
    nextRunAt: DUE,
    lastRunAt: null,
    lastJobId: null,
    consecutiveFailures: 0,
    lastError: null,
    createdAt: DUE,
    updatedAt: DUE,
    ...overrides,
  };
}

function deps(overrides: Partial<SchedulerTickDeps> = {}): SchedulerTickDeps {
  return {
    claim: vi.fn().mockResolvedValue([schedule()]),
    completeRun: vi.fn().mockResolvedValue(true),
    releaseRun: vi.fn().mockResolvedValue(true),
    failRun: vi.fn().mockResolvedValue('active'),
    startReview: vi.fn().mockResolvedValue({ id: 'job-9' }),
    token: 'machine-token',
    batchSize: 5,
    maxFailures: 3,
    retryBackoffMin: 10,
    now: () => NOW,
    ...overrides,
  };
}

describe('runSchedulerTick', () => {
  it('does nothing when nothing is due', async () => {
    const d = deps({ claim: vi.fn().mockResolvedValue([]) });
    await expect(runSchedulerTick(d)).resolves.toEqual({
      claimed: 0,
      launched: 0,
      deferred: 0,
      failed: 0,
    });
    expect(d.startReview).not.toHaveBeenCalled();
  });

  it('claims a batch, launches with the machine token and records the run', async () => {
    const d = deps();
    await expect(runSchedulerTick(d)).resolves.toMatchObject({ claimed: 1, launched: 1 });

    expect(d.claim).toHaveBeenCalledWith(NOW, 5);
    expect(d.startReview).toHaveBeenCalledWith({
      userId: 'u1',
      token: 'machine-token',
      target: TARGET,
      scheduleId: 's1',
    });
    expect(d.completeRun).toHaveBeenCalledWith('s1', {
      // Anchored to the instant the run was due, not to the tick's clock.
      nextRunAt: new Date('2026-05-05T09:00:00.000Z'),
      ranAt: NOW,
      jobId: 'job-9',
    });
    expect(d.failRun).not.toHaveBeenCalled();
  });

  it('walks the whole batch even though one schedule fails', async () => {
    const d = deps({
      claim: vi.fn().mockResolvedValue([schedule({ id: 'a' }), schedule({ id: 'b' })]),
      startReview: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'job-2' }),
    });
    await expect(runSchedulerTick(d)).resolves.toMatchObject({
      claimed: 2,
      launched: 1,
      failed: 1,
    });
    expect(d.completeRun).toHaveBeenCalledWith('b', expect.objectContaining({ jobId: 'job-2' }));
  });

  it('defers, without a failure, when the owner is already at their job cap', async () => {
    const d = deps({ startReview: vi.fn().mockRejectedValue(new JobInFlightError('busy-1')) });
    await expect(runSchedulerTick(d)).resolves.toMatchObject({ deferred: 1, failed: 0 });
    expect(d.releaseRun).toHaveBeenCalled();
    expect(d.failRun).not.toHaveBeenCalled();
    expect(d.completeRun).not.toHaveBeenCalled();
  });

  it('backs off by SCHEDULE_RETRY_BACKOFF_MIN when a launch throws', async () => {
    const d = deps({ startReview: vi.fn().mockRejectedValue(new GithubAuthError()) });
    await expect(runSchedulerTick(d)).resolves.toMatchObject({ failed: 1, launched: 0 });
    expect(d.failRun).toHaveBeenCalledWith('s1', {
      message: 'github: the scheduler token was rejected',
      nextRunAt: new Date(NOW.getTime() + 10 * 60_000),
      maxFailures: 3,
    });
    expect(d.releaseRun).not.toHaveBeenCalled();
  });
});

describe('formatScheduleError', () => {
  it('names the scheduler token rather than the user’s', () => {
    expect(formatScheduleError(new GithubAuthError())).toContain('scheduler token');
  });

  it('falls back to the error message, then to the value itself', () => {
    expect(formatScheduleError(new Error('disk full'))).toBe('disk full');
    expect(formatScheduleError('nope')).toBe('nope');
  });
});
