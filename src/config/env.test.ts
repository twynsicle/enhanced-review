import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
  GITHUB_CLIENT_ID: 'Iv1.client',
  GITHUB_CLIENT_SECRET: 'shh',
  APP_ORIGIN: 'http://localhost:3000',
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

  it('requires every database and auth key', () => {
    for (const key of Object.keys(REQUIRED)) {
      const { [key]: _omitted, ...rest } = REQUIRED as Record<string, string>;
      expect(() => parseEnv(rest)).toThrowError(new RegExp(key));
    }
  });

  it('validates URL shape and secret length', () => {
    expect(() => parseEnv({ ...REQUIRED, DATABASE_URL: 'not a url' })).toThrowError(/DATABASE_URL/);
    expect(() => parseEnv({ ...REQUIRED, APP_ORIGIN: 'localhost' })).toThrowError(/APP_ORIGIN/);
    expect(() => parseEnv({ ...REQUIRED, SESSION_SECRET: 'short' })).toThrowError(/SESSION_SECRET/);
  });

  it('names every offending key in the error', () => {
    expect(() => parseEnv({ ...REQUIRED, PORT: 'not-a-port', LOG_LEVEL: 'loud' })).toThrowError(
      /Invalid environment:\n(.*\n)*.*PORT(.*\n)*.*LOG_LEVEL/,
    );
  });
});
