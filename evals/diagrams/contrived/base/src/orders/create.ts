import { randomUUID } from 'node:crypto';
import { log } from '../logger.ts';
import type { PaymentGateway } from '../payments/gateway.ts';
import type { Queue } from '../queue/queue.ts';
import type { Store } from '../store/store.ts';
import { validateAddress } from './address.ts';
import { transition, type Address, type Order, type OrderLine } from './order.ts';
import { CURRENCY, priceOrder } from './pricing.ts';

export interface CreateOrderInput {
  email: string;
  lines: OrderLine[];
  address: Address;
  cardToken: string;
}

export interface OrderDeps {
  store: Store;
  gateway: PaymentGateway;
  queue: Queue;
  clock: () => Date;
}

export async function createOrder(input: CreateOrderInput, deps: OrderDeps): Promise<Order> {
  const address = validateAddress(input.address);
  const price = priceOrder(input.lines, address.country);
  const now = deps.clock();
  const placed: Order = {
    id: randomUUID(),
    status: 'placed',
    email: input.email,
    lines: input.lines,
    address,
    total: price.total,
    paymentReference: null,
    refundReference: null,
    createdAt: now,
    updatedAt: now,
  };
  // Stored before the capture is attempted: a crash between the two leaves a
  // placed order for the abandoned sweep, never a charge with no record of it.
  await deps.store.putOrder(placed);

  const result = await deps.gateway.capture({
    amount: price.total,
    currency: CURRENCY,
    cardToken: input.cardToken,
    merchantReference: placed.id,
  });
  const answered = { ...placed, paymentReference: result.reference };
  if (result.outcome === 'declined') {
    const cancelled = transition(answered, 'cancelled', deps.clock());
    await deps.store.putOrder(cancelled);
    log.info('payment declined', { orderId: placed.id, reason: result.reason });
    return cancelled;
  }
  const paid = transition(answered, 'paid', deps.clock());
  await deps.store.putOrder(paid);
  await deps.queue.enqueue({ type: 'pack', orderId: paid.id });
  await deps.queue.enqueue({ type: 'email', orderId: paid.id, template: 'confirmed' });
  log.info('order paid', { orderId: paid.id, total: paid.total });
  return paid;
}
