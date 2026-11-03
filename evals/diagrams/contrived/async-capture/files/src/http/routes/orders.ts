import { createOrder, type CreateOrderInput, type OrderDeps } from '../../orders/create.ts';
import type { Address, OrderLine } from '../../orders/order.ts';
import { requireOrder } from '../../store/store.ts';
import { requireApiKey } from '../middleware/auth.ts';
import { HttpError, jsonBody } from '../middleware/json.ts';
import type { Route } from '../server.ts';

export function orderRoutes(apiKey: string, deps: OrderDeps): Route[] {
  const middleware = [requireApiKey(apiKey), jsonBody()];
  return [
    {
      method: 'POST',
      path: '/orders',
      middleware,
      handler: async (ctx) => {
        const order = await createOrder(parseInput(ctx.body), deps);
        // 202 while the gateway still owes the outcome; the storefront reads the order back later.
        return { status: order.status === 'placed' ? 202 : 201, body: order };
      },
    },
    {
      method: 'GET',
      path: '/orders/:id',
      middleware,
      handler: async (ctx) => {
        const order = await requireOrder(deps.store, ctx.params.id!);
        return { status: 200, body: order };
      },
    },
  ];
}

function parseInput(body: unknown): CreateOrderInput {
  if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
  const { email, lines, address, cardToken } = body;
  if (typeof email !== 'string' || !email.includes('@')) {
    throw new HttpError(400, 'email must be an address');
  }
  if (!Array.isArray(lines) || !lines.every(isLine)) {
    throw new HttpError(400, 'lines must each have a sku, a quantity and a unitPrice');
  }
  if (!isRecord(address)) throw new HttpError(400, 'address is required');
  if (typeof cardToken !== 'string' || cardToken === '') {
    throw new HttpError(400, 'cardToken is required');
  }
  return { email, lines, address: address as unknown as Address, cardToken };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLine(value: unknown): value is OrderLine {
  return (
    isRecord(value) &&
    typeof value.sku === 'string' &&
    typeof value.quantity === 'number' &&
    typeof value.unitPrice === 'number'
  );
}
