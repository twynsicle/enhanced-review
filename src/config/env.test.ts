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
      REVIEW_EXECUTOR: 'claude',
      REVIEW_MODEL: 'claude-haiku-4-5',
      REVIEW_TIMEOUT_MIN: 15,
      MAX_JOBS_PER_USER: 1,
      SCHEDULER_ENABLED: true,
      SCHEDULER_TICK_MS: 60_000,
      SCHEDULER_BATCH_SIZE: 5,
      SCHEDULE_MAX_FAILURES: 3,
      SCHEDULE_RETRY_BACKOFF_MIN: 10,
      MAX_SCHEDULES_PER_USER: 10,
      LIVE_POLL_MS: 2000,
      TERMINAL_POLL_MS: 10_000,
    });
  });

  it('parses the scheduler keys', () => {
    const env = parseEnv({
      ...REQUIRED,
      SCHEDULER_ENABLED: '0',
      SCHEDULER_TICK_MS: '30000',
      SCHEDULER_BATCH_SIZE: '20',
      SCHEDULER_GITHUB_TOKEN: 'ghp_machine',
      SCHEDULE_MAX_FAILURES: '5',
      SCHEDULE_RETRY_BACKOFF_MIN: '30',
      MAX_SCHEDULES_PER_USER: '25',
    });
    expect(env.SCHEDULER_ENABLED).toBe(false);
    expect(env.SCHEDULER_TICK_MS).toBe(30_000);
    expect(env.SCHEDULER_BATCH_SIZE).toBe(20);
    expect(env.SCHEDULER_GITHUB_TOKEN).toBe('ghp_machine');
    expect(env.SCHEDULE_MAX_FAILURES).toBe(5);
    expect(env.SCHEDULE_RETRY_BACKOFF_MIN).toBe(30);
    expect(env.MAX_SCHEDULES_PER_USER).toBe(25);
  });

  it('refuses a tick faster than five seconds', () => {
    expect(() => parseEnv({ ...REQUIRED, SCHEDULER_TICK_MS: '1000' })).toThrowError(
      /SCHEDULER_TICK_MS/,
    );
  });

  it('parses the review runner keys', () => {
    const env = parseEnv({
      ...REQUIRED,
      REVIEW_EXECUTOR: 'stub',
      REVIEW_MODEL: 'claude-sonnet-5',
      REVIEW_TIMEOUT_MIN: '30',
      MAX_JOBS_PER_USER: '2',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(env.REVIEW_EXECUTOR).toBe('stub');
    expect(env.REVIEW_MODEL).toBe('claude-sonnet-5');
    expect(env.REVIEW_TIMEOUT_MIN).toBe(30);
    expect(env.MAX_JOBS_PER_USER).toBe(2);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  it('rejects an unknown executor and non-positive limits', () => {
    expect(() => parseEnv({ ...REQUIRED, REVIEW_EXECUTOR: 'gpt' })).toThrowError(/REVIEW_EXECUTOR/);
    expect(() => parseEnv({ ...REQUIRED, REVIEW_TIMEOUT_MIN: '0' })).toThrowError(
      /REVIEW_TIMEOUT_MIN/,
    );
    expect(() => parseEnv({ ...REQUIRED, MAX_JOBS_PER_USER: '1.5' })).toThrowError(
      /MAX_JOBS_PER_USER/,
    );
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
