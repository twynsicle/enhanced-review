import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armTimeout, timeoutMessage } from './timeout.server.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('armTimeout', () => {
  it('marks the job errored and then aborts with reason timeout', async () => {
    const order: string[] = [];
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => order.push('abort'));
    const markErrored = vi.fn(async () => {
      order.push('markErrored');
      return true;
    });

    armTimeout('j1', controller, { minutes: 2, markErrored });
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1);
    expect(markErrored).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(markErrored).toHaveBeenCalledWith('j1', 'timeout: job exceeded 2 min');
    expect(controller.signal.reason).toBe('timeout');
    expect(order).toEqual(['markErrored', 'abort']);
  });

  it('does nothing once disarmed', async () => {
    const controller = new AbortController();
    const markErrored = vi.fn(async () => true);
    const disarm = armTimeout('j1', controller, { minutes: 1, markErrored });
    disarm();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(markErrored).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
  });

  it('still aborts when the status write fails', async () => {
    const controller = new AbortController();
    const markErrored = vi.fn(async () => {
      throw new Error('db down');
    });
    armTimeout('j1', controller, { minutes: 1, markErrored });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.signal.reason).toBe('timeout');
  });

  it('formats the message from the configured minutes', () => {
    expect(timeoutMessage(15)).toBe('timeout: job exceeded 15 min');
  });
});
