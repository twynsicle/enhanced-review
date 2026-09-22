import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostEnv } from './host-env.ts';

afterEach(() => vi.unstubAllEnvs());

describe('hostEnv', () => {
  it('returns a copy, not the live object', () => {
    vi.stubEnv('ER_TEST_HOST_ENV', 'one');
    const snapshot = hostEnv();
    expect(snapshot['ER_TEST_HOST_ENV']).toBe('one');
    vi.stubEnv('ER_TEST_HOST_ENV', 'two');
    expect(snapshot['ER_TEST_HOST_ENV']).toBe('one');
  });
});
