import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Job } from '../queue/jobs.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { processOne, type Handlers } from './worker.ts';

function handlers(pack: (job: Job) => Promise<void>): Handlers {
  const unexpected = (job: Job) => Promise.reject(new Error(`unexpected ${job.type}`));
  return { pack, ship: unexpected, email: unexpected };
}

async function drain(queue: MemoryQueue, h: Handlers): Promise<number> {
  let runs = 0;
  while (await processOne(queue, h)) runs += 1;
  return runs;
}

describe('processOne', () => {
  it('reports nothing to do on an empty queue', async () => {
    assert.equal(await processOne(new MemoryQueue(), handlers(() => Promise.resolve())), false);
  });

  it('hands a job to its handler and acks it', async () => {
    const queue = new MemoryQueue();
    await queue.enqueue({ type: 'pack', orderId: 'ord_1' });
    const seen: string[] = [];
    const h = handlers((job) => {
      seen.push(job.orderId);
      return Promise.resolve();
    });
    assert.equal(await processOne(queue, h), true);
    assert.deepEqual(seen, ['ord_1']);
    assert.equal(await queue.size(), 0);
  });

  it('runs a failed job once more and keeps the result of the retry', async () => {
    const queue = new MemoryQueue();
    await queue.enqueue({ type: 'pack', orderId: 'ord_1' });
    let calls = 0;
    const h = handlers(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('carrier blip')) : Promise.resolve();
    });
    assert.equal(await drain(queue, h), 2);
    assert.equal(calls, 2);
    assert.equal(await queue.size(), 0);
  });

  it('drops a job that fails its retry too', async () => {
    const queue = new MemoryQueue();
    await queue.enqueue({ type: 'pack', orderId: 'ord_1' });
    let calls = 0;
    const h = handlers(() => {
      calls += 1;
      return Promise.reject(new Error('still down'));
    });
    assert.equal(await drain(queue, h), 2);
    assert.equal(calls, 2);
    assert.equal(await queue.size(), 0);
  });

  it('retries in arrival order behind jobs already waiting', async () => {
    const queue = new MemoryQueue();
    await queue.enqueue({ type: 'pack', orderId: 'ord_1' });
    await queue.enqueue({ type: 'pack', orderId: 'ord_2' });
    const seen: string[] = [];
    const h = handlers((job) => {
      seen.push(job.orderId);
      return seen.length === 1 ? Promise.reject(new Error('once')) : Promise.resolve();
    });
    await drain(queue, h);
    assert.deepEqual(seen, ['ord_1', 'ord_2', 'ord_1']);
  });
});
