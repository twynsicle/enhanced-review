import { createHmac, timingSafeEqual } from 'node:crypto';
import { log } from '../../logger.ts';
import { markPaid, type SettleDeps } from '../../orders/create.ts';
import { transition } from '../../orders/order.ts';
import { requireOrder } from '../../store/store.ts';
import { HttpError, jsonBody } from '../middleware/json.ts';
import type { Middleware, Reply, Route } from '../server.ts';

interface RefundNotice {
  event: 'refund';
  merchantReference: string;
  refundReference: string;
}

interface CaptureNotice {
  event: 'capture.completed' | 'capture.declined';
  merchantReference: string;
  reason?: string;
}

const HANDLED: Reply = { status: 200, body: { handled: true } };

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

export function webhookRoutes(secret: string, deps: SettleDeps): Route[] {
  return [
    {
      method: 'POST',
      path: '/webhooks/payment',
      middleware: [cardflowSignature(secret), jsonBody()],
      handler: (ctx) => {
        const notice = ctx.body as Partial<RefundNotice | CaptureNotice> | undefined;
        switch (notice?.event) {
          case 'refund':
            return recordRefund(notice, deps);
          case 'capture.completed':
          case 'capture.declined':
            return settleCapture(notice, deps);
          default:
            log.info('webhook event not handled', { event: notice?.event });
            return Promise.resolve({ status: 200, body: { handled: false } });
        }
      },
    },
  ];
}

async function recordRefund(notice: Partial<RefundNotice>, deps: SettleDeps): Promise<Reply> {
  if (!notice.merchantReference || !notice.refundReference) {
    throw new HttpError(400, 'a refund notice needs merchantReference and refundReference');
  }
  const order = await requireOrder(deps.store, notice.merchantReference);
  const refundReference = notice.refundReference;
  await deps.store.putOrder({ ...order, refundReference, updatedAt: deps.clock() });
  log.info('refund recorded', { orderId: order.id, refundReference });
  return HANDLED;
}

/**
 * Cardflow sends a notice again until it gets a 200 for it, so one that
 * arrives for an order already settled is acknowledged and left alone.
 */
async function settleCapture(notice: Partial<CaptureNotice>, deps: SettleDeps): Promise<Reply> {
  const id = notice.merchantReference;
  if (!id) throw new HttpError(400, 'a capture notice needs merchantReference');
  const order = await requireOrder(deps.store, id);
  if (order.status !== 'placed') {
    log.info('settled order, capture notice ignored', { orderId: order.id, event: notice.event });
    return HANDLED;
  }
  if (notice.event === 'capture.declined') {
    await deps.store.putOrder(transition(order, 'cancelled', deps.clock()));
    log.info('capture declined', { orderId: order.id, reason: notice.reason });
  } else {
    await markPaid(order, deps);
  }
  return HANDLED;
}
