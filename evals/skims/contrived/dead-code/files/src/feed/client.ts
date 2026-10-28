import { request } from 'undici';
import type { Config } from '../config.ts';
import { parseFeed, type FeedRow } from './parse.ts';

export interface FeedFetch {
  rows: FeedRow[];
  fetchedAt: Date;
}

export async function fetchFeed(config: Config): Promise<FeedFetch> {
  const response = await request(config.feedUrl, {
    method: 'GET',
    headersTimeout: config.feedTimeoutMs,
    bodyTimeout: config.feedTimeoutMs,
  });
  if (response.statusCode !== 200) {
    throw new Error(`feed returned ${response.statusCode}`);
  }
  const text = await response.body.text();
  return { rows: parseFeed(text), fetchedAt: new Date() };
}
