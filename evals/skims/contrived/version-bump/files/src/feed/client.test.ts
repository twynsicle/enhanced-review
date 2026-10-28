import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Config } from '../config.ts';
import { fetchFeed, type FeedDeps } from './client.ts';

const config: Config = {
  feedUrl: 'https://feed.example.test/stock.csv',
  feedTimeoutMs: 100,
  feedRetries: 2,
  legacyFeed: false,
  locale: 'en',
  batchSize: 500,
};

/** A request that fails `failures` times, then serves one row. */
function deps(failures: number): FeedDeps & { calls: number; slept: number[] } {
  const state = { calls: 0, slept: [] as number[] };
  return {
    ...state,
    request: (() => {
      state.calls += 1;
      if (state.calls <= failures) return Promise.reject(new Error('socket hang up'));
      return Promise.resolve({
        statusCode: 200,
        body: { text: () => Promise.resolve('a1,4,north,,\n') },
      });
    }) as unknown as FeedDeps['request'],
    sleep: (ms) => {
      state.slept.push(ms);
      return Promise.resolve();
    },
    get calls() {
      return state.calls;
    },
    get slept() {
      return state.slept;
    },
  };
}

describe('fetchFeed', () => {
  it('returns on the first success', async () => {
    const d = deps(0);
    const feed = await fetchFeed(config, d);
    assert.equal(feed.attempts, 1);
    assert.equal(feed.rows.length, 1);
    assert.deepEqual(d.slept, []);
  });

  it('retries with a growing backoff and reports the attempts', async () => {
    const d = deps(2);
    const feed = await fetchFeed(config, d);
    assert.equal(feed.attempts, 3);
    assert.deepEqual(d.slept, [2000, 4000]);
  });

  it('gives up after the configured retries and names the last error', async () => {
    const d = deps(3);
    await assert.rejects(fetchFeed(config, d), /after 3 attempts: socket hang up/);
    assert.equal(d.calls, 3);
  });

  it('does not retry at all with FEED_RETRIES=0', async () => {
    const d = deps(1);
    await assert.rejects(fetchFeed({ ...config, feedRetries: 0 }, d), /after 1 attempts/);
    assert.deepEqual(d.slept, []);
  });
});
