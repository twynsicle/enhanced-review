export const VERSION = '1.4.2';

export interface Config {
  feedUrl: string;
  feedTimeoutMs: number;
  locale: string;
  batchSize: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const feedUrl = env.FEED_URL;
  if (!feedUrl) throw new Error('FEED_URL is required');
  return {
    feedUrl,
    feedTimeoutMs: integer(env.FEED_TIMEOUT_MS, 8000),
    locale: env.LOCALE ?? 'en',
    batchSize: integer(env.BATCH_SIZE, 500),
  };
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got ${value}`);
  }
  return parsed;
}
