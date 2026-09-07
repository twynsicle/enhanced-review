import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

describe('parseEnv', () => {
  it('applies defaults to an empty environment', () => {
    const env = parseEnv({});
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
    });
  });

  it('coerces and transforms provided values', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      APP_VERSION: 'abc123',
      LOG_LEVEL: 'debug',
      LOG_PRETTY: '1',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(8080);
    expect(env.APP_VERSION).toBe('abc123');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.LOG_PRETTY).toBe(true);
  });

  it('treats empty strings as unset', () => {
    const env = parseEnv({ PORT: '', LOG_LEVEL: '', APP_VERSION: '' });
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.APP_VERSION).toBeUndefined();
  });

  it('ignores keys the schema does not know', () => {
    const env = parseEnv({ UNRELATED: 'x' });
    expect('UNRELATED' in env).toBe(false);
  });

  it('names every offending key in the error', () => {
    expect(() => parseEnv({ PORT: 'not-a-port', LOG_LEVEL: 'loud' })).toThrowError(
      /Invalid environment:\n(.*\n)*.*PORT(.*\n)*.*LOG_LEVEL/,
    );
  });
});
