import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newTraceId, RunCounters } from './trace.ts';

describe('newTraceId', () => {
  it('is twelve hex characters and differs between calls', () => {
    const a = newTraceId();
    assert.match(a, /^[0-9a-f]{12}$/);
    assert.notEqual(a, newTraceId());
  });
});

describe('RunCounters', () => {
  it('adds up by name and snapshots in name order', () => {
    const counters = new RunCounters();
    counters.add('rows');
    counters.add('rows', 4);
    counters.add('batches');
    assert.deepEqual(counters.snapshot(), { batches: 1, rows: 5 });
  });
});
