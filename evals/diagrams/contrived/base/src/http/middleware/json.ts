import { errorFields, log } from '../../logger.ts';
import { AddressError } from '../../orders/address.ts';
import { TransitionError } from '../../orders/order.ts';
import { GatewayError } from '../../payments/gateway.ts';
import { OrderNotFound } from '../../store/store.ts';
import type { Middleware, Reply } from '../server.ts';

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function jsonBody(): Middleware {
  return async (ctx, next) => {
    if (ctx.text !== '') {
      try {
        ctx.body = JSON.parse(ctx.text);
      } catch {
        return { status: 400, body: { error: 'body is not JSON' } };
      }
    }
    try {
      return await next();
    } catch (error) {
      return replyFor(error);
    }
  };
}

export function replyFor(error: unknown): Reply {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
  if (error instanceof AddressError) {
    return { status: 400, body: { error: error.message, field: error.field } };
  }
  if (error instanceof RangeError) return { status: 400, body: { error: error.message } };
  if (error instanceof OrderNotFound) return { status: 404, body: { error: error.message } };
  if (error instanceof TransitionError) return { status: 409, body: { error: error.message } };
  if (error instanceof GatewayError) return { status: 502, body: { error: error.message } };
  log.error('request failed', errorFields(error));
  return { status: 500, body: { error: 'internal error' } };
}
