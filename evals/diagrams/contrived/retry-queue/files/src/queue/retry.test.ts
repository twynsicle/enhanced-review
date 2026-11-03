import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BACKOFF_MS, MemoryRetryQueue, queueRetry, type Retry } from './retry.ts';

const now = new Date('2024-05-02T12:00:00Z');

const minutesAfter = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

function retry(orderId: string, dueAt: Date, attempt = 1): Retry {
  return { orderId, cardToken: 'tok_visa', attempt, dueAt };
}

describe('MemoryRetryQueue', () => {
  it('answers the retries that have come due, earliest first', async () => {
    const q = new MemoryRetryQueue();
    await q.schedule(retry('late', minutesAfter(10)));
    await q.schedule(retry('soon', minutesAfter(1)));
    await q.schedule(retry('now', now));
    assert.deepEqual(
      (await q.due(minutesAfter(1))).map((r) => r.orderId),
      ['now', 'soon'],
    );
  });

  it('keeps a retry until it is removed', async () => {
    const q = new MemoryRetryQueue();
    await q.schedule(retry('ord_1', now));
    assert.equal((await q.due(now)).length, 1);
    assert.equal((await q.due(now)).length, 1);
    await q.remove('ord_1');
    assert.deepEqual(await q.due(now), []);
  });

  it('holds one retry per order, the last scheduled', async () => {
    const q = new MemoryRetryQueue();
    await q.schedule(retry('ord_1', now));
    await q.schedule(retry('ord_1', minutesAfter(5), 2));
    assert.deepEqual(await q.due(now), []);
    assert.deepEqual(await q.due(minutesAfter(5)), [retry('ord_1', minutesAfter(5), 2)]);
  });
});

describe('queueRetry', () => {
  it('spaces the attempts out along the backoff', async () => {
    const q = new MemoryRetryQueue();
    for (const attempt of [1, 2, 3]) {
      await queueRetry(q, { orderId: `ord_${attempt}`, cardToken: 'tok_visa', attempt }, now);
    }
    const dueAt = (await q.due(minutesAfter(30))).map((r) => r.dueAt);
    assert.deepEqual(dueAt, [minutesAfter(1), minutesAfter(5), minutesAfter(30)]);
  });

  it('refuses an attempt past the last and queues nothing', async () => {
    const q = new MemoryRetryQueue();
    const spent = { orderId: 'ord_1', cardToken: 'tok_visa', attempt: BACKOFF_MS.length + 1 };
    assert.equal(await queueRetry(q, spent, now), false);
    assert.deepEqual(await q.due(minutesAfter(60)), []);
  });
});
