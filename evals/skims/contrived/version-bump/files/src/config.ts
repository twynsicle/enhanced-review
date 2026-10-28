export const VERSION = '1.5.0';

export interface Config {
  feedUrl: string;
  feedTimeoutMs: number;
  feedRetries: number;
  legacyFeed: boolean;
  locale: string;
  batchSize: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const feedUrl = env.FEED_URL;
  if (!feedUrl) throw new Error('FEED_URL is required');
  return {
    feedUrl,
    feedTimeoutMs: integer(env.FEED_TIMEOUT_MS, 5000),
    feedRetries: integer(env.FEED_RETRIES, 2, { allowZero: true }),
    legacyFeed: env.LEGACY_FEED === 'true',
    locale: env.LOCALE ?? 'en',
    batchSize: integer(env.BATCH_SIZE, 500),
  };
}

function integer(
  value: string | undefined,
  fallback: number,
  { allowZero = false }: { allowZero?: boolean } = {},
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`expected a ${allowZero ? 'non-negative' : 'positive'} integer, got ${value}`);
  }
  return parsed;
}
