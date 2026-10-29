import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentEnv, hostEnv, MAX_OUTPUT_TOKENS } from './host-env.ts';

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

describe('agentEnv', () => {
  it('passes the host environment on', () => {
    vi.stubEnv('ER_TEST_HOST_ENV', 'one');
    expect(agentEnv()['ER_TEST_HOST_ENV']).toBe('one');
  });

  it('gives the answer room past Claude Code’s 32k default', () => {
    vi.stubEnv('CLAUDE_CODE_MAX_OUTPUT_TOKENS', undefined);
    expect(agentEnv()['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe(String(MAX_OUTPUT_TOKENS));
  });

  it('treats an empty output cap as unset, as Claude Code does', () => {
    vi.stubEnv('CLAUDE_CODE_MAX_OUTPUT_TOKENS', '');
    expect(agentEnv()['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe(String(MAX_OUTPUT_TOKENS));
  });

  it('keeps an output cap the engineer set themselves', () => {
    vi.stubEnv('CLAUDE_CODE_MAX_OUTPUT_TOKENS', '48000');
    expect(agentEnv()['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe('48000');
  });

  it('tells git to use no bare repository it was not pointed at', () => {
    vi.stubEnv('GIT_CONFIG_COUNT', undefined);
    expect(agentEnv()).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.bareRepository',
      GIT_CONFIG_VALUE_0: 'explicit',
    });
  });

  it('adds to the engineer’s own GIT_CONFIG entries rather than replacing them', () => {
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.autocrlf');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true');
    expect(agentEnv()).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_KEY_1: 'safe.bareRepository',
      GIT_CONFIG_VALUE_1: 'explicit',
    });
  });
});
