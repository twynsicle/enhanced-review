import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normaliseSku } from './cells.ts';
import { parseFeed, parseLegacyFeed } from './parse.ts';

describe('parseFeed', () => {
  it('reads the five-column format', () => {
    const rows = parseFeed('a1,4,north,pallet,2024-05-01\n');
    assert.deepEqual(rows, [{ sku: 'A1', quantity: 4, depot: 'north', updatedAt: '2024-05-01' }]);
  });

  it('skips blank lines and comments', () => {
    assert.equal(parseFeed('# header\n\na1,4,north,,\n').length, 1);
  });

  it('refuses a short row', () => {
    assert.throws(() => parseFeed('a1,4,north\n'), /five columns/);
  });

  it('clamps a negative quantity to zero', () => {
    assert.equal(parseFeed('a1,-3,north,,\n')[0]!.quantity, 0);
  });
});

describe('parseLegacyFeed', () => {
  it('reads the three-column format', () => {
    const rows = parseLegacyFeed('a1;north;4\n');
    assert.deepEqual(rows, [{ sku: 'A1', quantity: 4, depot: 'north', updatedAt: null }]);
  });

  it('refuses a row with the wrong number of columns', () => {
    assert.throws(() => parseLegacyFeed('a1;north\n'), /three columns/);
  });
});

describe('normaliseSku', () => {
  it('upper-cases and strips whitespace', () => {
    assert.equal(normaliseSku(' ab 12 '), 'AB12');
  });
});
