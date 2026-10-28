import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcile, type Adjustment, type StockLevel, type Warehouse } from './reconcile.ts';

function warehouse(levels: StockLevel[]): Warehouse & { applied: Adjustment[][] } {
  const applied: Adjustment[][] = [];
  return {
    applied,
    levels: (depot) =>
      Promise.resolve(depot === null ? levels : levels.filter((level) => level.depot === depot)),
    apply: (batch) => {
      applied.push(batch);
      return Promise.resolve();
    },
  };
}

const row = (sku: string, quantity: number, depot = 'north') => ({
  sku,
  quantity,
  depot,
  updatedAt: null,
});

describe('reconcile', () => {
  it('adjusts a level the feed disagrees with', async () => {
    const w = warehouse([{ sku: 'A1', depot: 'north', quantity: 4 }]);
    const result = await reconcile([row('A1', 9)], w, 500, null);
    assert.deepEqual(result.adjustments, [{ sku: 'A1', depot: 'north', from: 4, to: 9 }]);
    assert.equal(result.unchanged, 0);
  });

  it('leaves a matching level alone and counts it', async () => {
    const w = warehouse([{ sku: 'A1', depot: 'north', quantity: 4 }]);
    const result = await reconcile([row('A1', 4)], w, 500, null);
    assert.deepEqual(result.adjustments, []);
    assert.equal(result.unchanged, 1);
    assert.deepEqual(w.applied, []);
  });

  it('reports a SKU the warehouse does not know rather than creating it', async () => {
    const w = warehouse([]);
    const result = await reconcile([row('ZZ9', 1)], w, 500, null);
    assert.deepEqual(result.unknown, ['ZZ9']);
  });

  it('applies adjustments in batches', async () => {
    const levels = ['A', 'B', 'C'].map((sku) => ({ sku, depot: 'north', quantity: 0 }));
    const w = warehouse(levels);
    await reconcile(['A', 'B', 'C'].map((sku) => row(sku, 1)), w, 2, null);
    assert.deepEqual(
      w.applied.map((batch) => batch.length),
      [2, 1],
    );
  });

  it('syncs only the depot it was given', async () => {
    const w = warehouse([
      { sku: 'A1', depot: 'north', quantity: 4 },
      { sku: 'A1', depot: 'south', quantity: 4 },
    ]);
    const result = await reconcile([row('A1', 9), row('A1', 9, 'south')], w, 500, 'south');
    assert.deepEqual(result.adjustments, [{ sku: 'A1', depot: 'south', from: 4, to: 9 }]);
    assert.deepEqual(result.unknown, []);
    assert.equal(result.unchanged, 0);
  });
});
