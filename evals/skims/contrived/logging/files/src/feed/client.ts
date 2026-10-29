import { request } from 'undici';
import type { Config } from '../config.ts';
import { log } from '../logger.ts';
import { parseFeed, parseLegacyFeed, type FeedRow } from './parse.ts';

export interface FeedFetch {
  rows: FeedRow[];
  fetchedAt: Date;
}

export async function fetchFeed(config: Config, trace: string): Promise<FeedFetch> {
  log.debug('feed: fetching', { trace, url: config.feedUrl, timeoutMs: config.feedTimeoutMs });
  const response = await request(config.feedUrl, {
    method: 'GET',
    headersTimeout: config.feedTimeoutMs,
    bodyTimeout: config.feedTimeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`feed returned ${response.statusCode}`);
  }
  const text = await response.body.text();
  const rows = config.legacyFeed ? parseLegacyFeed(text) : parseFeed(text);
  log.debug('feed: parsed', { trace, rows: rows.length, bytes: text.length, legacy: config.legacyFeed });
  return { rows, fetchedAt: new Date() };
}
