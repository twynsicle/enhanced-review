import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcile, type Adjustment, type StockLevel, type Warehouse } from './reconcile.ts';

function warehouse(levels: StockLevel[]): Warehouse & { applied: Adjustment[][] } {
  const applied: Adjustment[][] = [];
  return {
    applied,
    levels: () => Promise.resolve(levels),
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
    const stock = warehouse([{ sku: 'A1', depot: 'north', quantity: 4 }]);
    const result = await reconcile([row('A1', 9)], stock, 500);
    assert.deepEqual(result.adjustments, [{ sku: 'A1', depot: 'north', from: 4, to: 9 }]);
    assert.equal(result.unchanged, 0);
  });

  it('leaves a matching level alone and counts it', async () => {
    const stock = warehouse([{ sku: 'A1', depot: 'north', quantity: 4 }]);
    const result = await reconcile([row('A1', 4)], stock, 500);
    assert.deepEqual(result.adjustments, []);
    assert.equal(result.unchanged, 1);
    assert.deepEqual(stock.applied, []);
  });

  it('reports a SKU the warehouse does not know rather than creating it', async () => {
    const stock = warehouse([]);
    const result = await reconcile([row('ZZ9', 1)], stock, 500);
    assert.deepEqual(result.unknown, ['ZZ9']);
  });

  it('applies adjustments in batches', async () => {
    const levels = ['A', 'B', 'C'].map((sku) => ({ sku, depot: 'north', quantity: 0 }));
    const stock = warehouse(levels);
    await reconcile(['A', 'B', 'C'].map((sku) => row(sku, 1)), stock, 2);
    assert.deepEqual(
      stock.applied.map((batch) => batch.length),
      [2, 1],
    );
  });
});
