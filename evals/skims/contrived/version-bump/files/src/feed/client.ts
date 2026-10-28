import { request } from 'undici';
import type { Config } from '../config.ts';
import { parseFeed, parseLegacyFeed, type FeedRow } from './parse.ts';

export interface FeedFetch {
  rows: FeedRow[];
  fetchedAt: Date;
  /** How many attempts it took, 1 when the first succeeded. */
  attempts: number;
}

export interface FeedDeps {
  request: typeof request;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: FeedDeps = {
  request,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const BACKOFF_MS = 2000;

export async function fetchFeed(config: Config, deps: FeedDeps = defaultDeps): Promise<FeedFetch> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= config.feedRetries + 1; attempt += 1) {
    try {
      const text = await fetchOnce(config, deps);
      const rows = config.legacyFeed ? parseLegacyFeed(text) : parseFeed(text);
      return { rows, fetchedAt: new Date(), attempts: attempt };
    } catch (error) {
      lastError = error as Error;
      if (attempt <= config.feedRetries) await deps.sleep(BACKOFF_MS * attempt);
    }
  }
  throw new Error(`feed failed after ${config.feedRetries + 1} attempts: ${lastError?.message}`);
}

async function fetchOnce(config: Config, deps: FeedDeps): Promise<string> {
  const response = await deps.request(config.feedUrl, {
    method: 'GET',
    headersTimeout: config.feedTimeoutMs,
    bodyTimeout: config.feedTimeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`feed returned ${response.statusCode}`);
  }
  return response.body.text();
}
