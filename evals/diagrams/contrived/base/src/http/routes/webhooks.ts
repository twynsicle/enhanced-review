import { createHmac, timingSafeEqual } from 'node:crypto';
import { log } from '../../logger.ts';
import { requireOrder, type Store } from '../../store/store.ts';
import { HttpError, jsonBody } from '../middleware/json.ts';
import type { Middleware, Route } from '../server.ts';

interface RefundNotice {
  event: 'refund';
  merchantReference: string;
  refundReference: string;
}

/** Cardflow signs the raw body, so this runs before anything parses it. */
export function cardflowSignature(secret: string): Middleware {
  return (ctx, next) => {
    const header = ctx.headers['x-cardflow-signature'];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(createHmac('sha256', secret).update(ctx.text).digest('hex'));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.resolve({ status: 401, body: { error: 'bad signature' } });
    }
    return next();
  };
}

export function webhookRoutes(secret: string, store: Store, clock: () => Date): Route[] {
  return [
    {
      method: 'POST',
      path: '/webhooks/payment',
      middleware: [cardflowSignature(secret), jsonBody()],
      handler: async (ctx) => {
        const notice = ctx.body as Partial<RefundNotice> | undefined;
        if (notice?.event !== 'refund') {
          log.info('webhook event not handled', { event: notice?.event });
          return { status: 200, body: { handled: false } };
        }
        if (!notice.merchantReference || !notice.refundReference) {
          throw new HttpError(400, 'a refund notice needs merchantReference and refundReference');
        }
        const order = await requireOrder(store, notice.merchantReference);
        const refundReference = notice.refundReference;
        await store.putOrder({ ...order, refundReference, updatedAt: clock() });
        log.info('refund recorded', { orderId: order.id, refundReference });
        return { status: 200, body: { handled: true } };
      },
    },
  ];
}
