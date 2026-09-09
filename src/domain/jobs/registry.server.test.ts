import { describe, expect, it } from 'vitest';
import { createRegistry, JOBS_REGISTRY_KEY, registry } from './registry.server.ts';

describe('createRegistry', () => {
  it('signals a registered job with the reason and reports unknown ids', () => {
    const reg = createRegistry();
    const controller = new AbortController();
    reg.register('j1', controller);

    expect(reg.signal('j1', 'cancel')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('cancel');
    expect(reg.signal('nope', 'cancel')).toBe(false);
  });

  it('forgets a job on unregister', () => {
    const reg = createRegistry();
    reg.register('j1', new AbortController());
    expect(reg.size()).toBe(1);
    reg.unregister('j1');
    expect(reg.size()).toBe(0);
    expect(reg.signal('j1', 'cancel')).toBe(false);
  });

  it('abortAll aborts every live job once and counts them', () => {
    const reg = createRegistry();
    const a = new AbortController();
    const b = new AbortController();
    const already = new AbortController();
    already.abort('cancel');
    reg.register('a', a);
    reg.register('b', b);
    reg.register('c', already);

    expect(reg.abortAll('shutdown')).toBe(2);
    expect(a.signal.reason).toBe('shutdown');
    expect(b.signal.reason).toBe('shutdown');
    expect(already.signal.reason).toBe('cancel');
  });

  it('drain waits for tracked runners and resolves immediately with none', async () => {
    const reg = createRegistry();
    await expect(reg.drain(1000)).resolves.toBeUndefined();

    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    reg.register('j1', new AbortController());
    reg.track('j1', done);

    let drained = false;
    const draining = reg.drain(1000).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await draining;
    expect(drained).toBe(true);
  });

  it('drain gives up after the timeout', async () => {
    const reg = createRegistry();
    reg.register('stuck', new AbortController());
    reg.track('stuck', new Promise(() => {}));
    await expect(reg.drain(10)).resolves.toBeUndefined();
  });

  it('track on an unknown id is a no-op', () => {
    const reg = createRegistry();
    expect(() => reg.track('ghost', Promise.resolve())).not.toThrow();
  });
});

describe('the shared registry', () => {
  it('is published on globalThis under the well-known key', () => {
    expect((globalThis as Record<symbol, unknown>)[JOBS_REGISTRY_KEY]).toBe(registry);
    expect(JOBS_REGISTRY_KEY).toBe(Symbol.for('enhanced-review.jobs.registry'));
  });
});
