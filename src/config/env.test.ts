import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
};

describe('parseEnv', () => {
  it('applies defaults when only the required keys are present', () => {
    const env = parseEnv(REQUIRED);
    expect(env).toEqual({
      ...REQUIRED,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
    });
  });

  it('coerces and transforms provided values', () => {
    const env = parseEnv({
      ...REQUIRED,
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
    const env = parseEnv({ ...REQUIRED, PORT: '', LOG_LEVEL: '', APP_VERSION: '' });
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.APP_VERSION).toBeUndefined();
  });

  it('ignores keys the schema does not know', () => {
    const env = parseEnv({ ...REQUIRED, UNRELATED: 'x' });
    expect('UNRELATED' in env).toBe(false);
  });

  it('requires DATABASE_URL to be a URL', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'not a url' })).toThrowError(/DATABASE_URL/);
  });

  it('names every offending key in the error', () => {
    expect(() => parseEnv({ ...REQUIRED, PORT: 'not-a-port', LOG_LEVEL: 'loud' })).toThrowError(
      /Invalid environment:\n(.*\n)*.*PORT(.*\n)*.*LOG_LEVEL/,
    );
  });
});
