import { log } from '../logger.ts';
import type { Mailer, Message } from '../notify/email.ts';
import { confirmed, shipped, type TemplateName } from '../notify/templates.ts';
import type { Order } from '../orders/order.ts';
import type { JobOf } from '../queue/jobs.ts';
import { requireOrder, type Store } from '../store/store.ts';

export interface EmailDeps {
  store: Store;
  mailer: Mailer;
}

export function emailHandler({ store, mailer }: EmailDeps): (job: JobOf<'email'>) => Promise<void> {
  return async (job) => {
    const order = await requireOrder(store, job.orderId);
    await mailer.send(await render(job.template, order, store));
    log.info('email sent', {
      orderId: order.id,
      template: job.template,
      status: order.status,
      at: order.updatedAt.toISOString(),
    });
  };
}

async function render(template: TemplateName, order: Order, store: Store): Promise<Message> {
  switch (template) {
    case 'confirmed':
      return confirmed(order);
    case 'shipped': {
      const shipment = await store.getShipment(order.id);
      if (!shipment) throw new Error(`order ${order.id} has no shipment to write about`);
      return shipped(order, shipment);
    }
  }
}
