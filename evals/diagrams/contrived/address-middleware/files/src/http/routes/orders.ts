import { createOrder, type CreateOrderInput, type OrderDeps } from '../../orders/create.ts';
import type { Address, OrderLine } from '../../orders/order.ts';
import { requireOrder } from '../../store/store.ts';
import { validateAddressBody } from '../middleware/address.ts';
import { requireApiKey } from '../middleware/auth.ts';
import { HttpError, isRecord, jsonBody } from '../middleware/json.ts';
import type { Route } from '../server.ts';

export function orderRoutes(apiKey: string, deps: OrderDeps): Route[] {
  const apiKeyCheck = requireApiKey(apiKey);
  return [
    {
      method: 'POST',
      path: '/orders',
      middleware: [apiKeyCheck, jsonBody(), validateAddressBody()],
      handler: async (ctx) => {
        const order = await createOrder(parseInput(ctx.body), deps);
        return { status: 201, body: order };
      },
    },
    {
      method: 'GET',
      path: '/orders/:id',
      middleware: [apiKeyCheck, jsonBody()],
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
  // An address that is here has been through validateAddressBody, which runs
  // before this handler and answers for itself when it refuses one.
  if (!isRecord(address)) throw new HttpError(400, 'address is required');
  if (typeof cardToken !== 'string' || cardToken === '') {
    throw new HttpError(400, 'cardToken is required');
  }
  return { email, lines, address: address as unknown as Address, cardToken };
}

function isLine(value: unknown): value is OrderLine {
  return (
    isRecord(value) &&
    typeof value.sku === 'string' &&
    typeof value.quantity === 'number' &&
    typeof value.unitPrice === 'number'
  );
}
