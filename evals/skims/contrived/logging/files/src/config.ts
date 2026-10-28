import type { Level } from './logger.ts';

export const VERSION = '1.4.2';

export interface Config {
  feedUrl: string;
  feedTimeoutMs: number;
  legacyFeed: boolean;
  locale: string;
  batchSize: number;
  logLevel: Level;
}

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const feedUrl = env.FEED_URL;
  if (!feedUrl) throw new Error('FEED_URL is required');
  return {
    feedUrl,
    feedTimeoutMs: integer(env.FEED_TIMEOUT_MS, 5000),
    legacyFeed: env.LEGACY_FEED === 'true',
    locale: env.LOCALE ?? 'en',
    batchSize: integer(env.BATCH_SIZE, 500),
    logLevel: level(env.LOG_LEVEL),
  };
}

function level(value: string | undefined): Level {
  if (value === undefined) return 'info';
  if (!LEVELS.includes(value as Level)) {
    throw new Error(`LOG_LEVEL must be one of ${LEVELS.join(', ')}, got ${value}`);
  }
  return value as Level;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got ${value}`);
  }
  return parsed;
}
