import { AddressError, validateAddress } from '../../orders/address.ts';
import type { Address } from '../../orders/order.ts';
import type { Middleware } from '../server.ts';
import { isRecord } from './json.ts';

/**
 * Runs after jsonBody and before the handler, so an address the shop cannot
 * ship to is answered before an order exists for it: nothing is stored and
 * the gateway is never asked. The handler is then handed the address as
 * validateAddress returns it, country and postcode normalised.
 *
 * A body with no address, or one that is not an object, is left to the
 * handler: that is a malformed body, answered 400 with the rest of its
 * shape, where a 422 here is an address that was read and refused.
 */
export function validateAddressBody(): Middleware {
  return (ctx, next) => {
    const body = ctx.body;
    if (!isRecord(body) || !isRecord(body.address)) return next();
    let address: Address;
    try {
      address = validateAddress(body.address as unknown as Address);
    } catch (error) {
      if (!(error instanceof AddressError)) throw error;
      return Promise.resolve({ status: 422, body: { error: error.message, field: error.field } });
    }
    ctx.body = { ...body, address };
    return next();
  };
}
