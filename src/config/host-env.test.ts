import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostEnv, pickHostEnv } from './host-env.ts';

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

describe('pickHostEnv', () => {
  it('keeps only the requested keys that are set', () => {
    vi.stubEnv('ER_TEST_A', 'a');
    vi.stubEnv('ER_TEST_B', 'b');
    expect(pickHostEnv(['ER_TEST_A', 'ER_TEST_MISSING'])).toEqual({ ER_TEST_A: 'a' });
  });

  it('returns an empty object for no keys', () => {
    expect(pickHostEnv([])).toEqual({});
  });
});
