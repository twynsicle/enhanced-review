import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootJobs, JOBS_BOOTED_KEY } from './boot.server.ts';
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

describe('bootJobs', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[JOBS_BOOTED_KEY];
  });

  it('recovers once per process, even when called again', async () => {
    const recover = vi.fn(async () => 1);
    await bootJobs(recover);
    await bootJobs(recover);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('swallows a recovery failure so the server still starts', async () => {
    const recover = vi.fn(async () => {
      throw new Error('db unreachable');
    });
    await expect(bootJobs(recover)).resolves.toBeUndefined();
  });
});
