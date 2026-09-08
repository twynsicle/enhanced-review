import { describe, expect, it, vi } from 'vitest';
import { cancelJob } from './cancel-job.server.ts';
import { createRegistry } from './registry.server.ts';

describe('cancelJob', () => {
  it('writes the status, then signals the running job with reason cancel', async () => {
    const registry = createRegistry();
    const controller = new AbortController();
    registry.register('j1', controller);
    const order: string[] = [];
    controller.signal.addEventListener('abort', () => order.push('signal'));
    const cancel = vi.fn(async () => {
      order.push('db');
      return true;
    });

    await expect(cancelJob({ jobId: 'j1', userId: 'u1' }, { cancel, registry })).resolves.toBe(
      'cancelled',
    );
    expect(cancel).toHaveBeenCalledWith('j1', 'u1');
    expect(order).toEqual(['db', 'signal']);
    expect(controller.signal.reason).toBe('cancel');
  });

  it('still reports cancelled when the job is pending in the database but not running here', async () => {
    const registry = createRegistry();
    const cancel = vi.fn(async () => true);
    await expect(cancelJob({ jobId: 'j1', userId: 'u1' }, { cancel, registry })).resolves.toBe(
      'cancelled',
    );
  });

  it('reports not-cancellable without signalling when the update matched nothing', async () => {
    const registry = createRegistry();
    const controller = new AbortController();
    registry.register('j1', controller);
    const cancel = vi.fn(async () => false);

    await expect(
      cancelJob({ jobId: 'j1', userId: 'someone-else' }, { cancel, registry }),
    ).resolves.toBe('not-cancellable');
    expect(controller.signal.aborted).toBe(false);
  });
});
