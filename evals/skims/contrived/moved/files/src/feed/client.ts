import { request } from 'undici';
import type { Config } from '../config.ts';
import { parseFeed, parseLegacyFeed, type FeedRow } from './parse.ts';

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
  checkStatus(response.statusCode);
  const text = await response.body.text();
  const rows = config.legacyFeed ? parseLegacyFeed(text) : parseFeed(text);
  return { rows, fetchedAt: new Date() };
}

function checkStatus(statusCode: number): void {
  if (statusCode >= 300) {
    throw new Error(`feed returned ${statusCode}`);
  }
}
