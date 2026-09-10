import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootJobs, JOBS_BOOTED_KEY, type BootJobsDeps } from './boot.server.ts';
import { RECOVERY_MESSAGE, recoverOrphanedJobs } from './recover-jobs.server.ts';

describe('recoverOrphanedJobs', () => {
  it('flips in-flight jobs to error with the restart message and returns the count', async () => {
    const recover = vi.fn(async () => 3);
    await expect(recoverOrphanedJobs(recover)).resolves.toBe(3);
    expect(recover).toHaveBeenCalledWith(RECOVERY_MESSAGE);
    expect(RECOVERY_MESSAGE).toBe('interrupted: server restarted');
  });

  it('returns zero when there is nothing to recover', async () => {
    await expect(recoverOrphanedJobs(async () => 0)).resolves.toBe(0);
  });
});

const deps = (overrides: Partial<BootJobsDeps> = {}): BootJobsDeps => ({
  recoverJobs: vi.fn(async () => 1),
  recoverSchedules: vi.fn(async () => 0),
  startScheduler: vi.fn(() => 'started' as const),
  ...overrides,
});

describe('bootJobs', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[JOBS_BOOTED_KEY];
  });

  it('recovers both tables and starts the loop, once per process', async () => {
    const d = deps();
    await bootJobs(d);
    await bootJobs(d);
    expect(d.recoverJobs).toHaveBeenCalledTimes(1);
    expect(d.recoverSchedules).toHaveBeenCalledTimes(1);
    expect(d.startScheduler).toHaveBeenCalledTimes(1);
  });

  it('swallows a recovery failure so the server still starts', async () => {
    const d = deps({
      recoverJobs: vi.fn(async () => {
        throw new Error('db unreachable');
      }),
    });
    await expect(bootJobs(d)).resolves.toBeUndefined();
    // The loop is armed even when recovery could not run: a schedule stuck in
    // `running` is a smaller problem than a scheduler that never ticks.
    expect(d.startScheduler).toHaveBeenCalledTimes(1);
  });

  it('releases claimed schedules before the first tick can skip them', async () => {
    const order: string[] = [];
    const d = deps({
      recoverSchedules: vi.fn(async () => {
        order.push('recover');
        return 2;
      }),
      startScheduler: vi.fn(() => {
        order.push('start');
        return 'started' as const;
      }),
    });
    await bootJobs(d);
    expect(order).toEqual(['recover', 'start']);
  });
});
