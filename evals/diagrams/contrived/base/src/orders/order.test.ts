import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canTransition,
  TRANSITIONS,
  transition,
  TransitionError,
  type Order,
  type OrderStatus,
} from './order.ts';

const at = new Date('2024-05-01T10:00:00Z');

function order(status: OrderStatus): Order {
  return {
    id: 'ord_1',
    status,
    email: 'ana@example.com',
    lines: [{ sku: 'MUG-01', quantity: 1, unitPrice: 1200 }],
    address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
    total: 1595,
    paymentReference: null,
    refundReference: null,
    createdAt: at,
    updatedAt: at,
  };
}

describe('transition', () => {
  it('moves along an allowed edge and stamps the time', () => {
    const later = new Date('2024-05-01T10:05:00Z');
    const paid = transition(order('placed'), 'paid', later);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.updatedAt, later);
  });

  it('refuses an edge the table does not have', () => {
    assert.throws(
      () => transition(order('placed'), 'shipped'),
      (error: unknown) =>
        error instanceof TransitionError && error.from === 'placed' && error.to === 'shipped',
    );
  });

  it('leaves shipped and cancelled with no way out', () => {
    for (const status of ['shipped', 'cancelled'] as const) {
      assert.deepEqual(TRANSITIONS[status], []);
      for (const to of Object.keys(TRANSITIONS) as OrderStatus[]) {
        assert.equal(canTransition(status, to), false);
      }
    }
  });

  it('does not change the order it was given', () => {
    const placed = order('placed');
    transition(placed, 'cancelled');
    assert.equal(placed.status, 'placed');
    assert.equal(placed.updatedAt, at);
  });
});
