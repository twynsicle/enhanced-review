import type { Order } from '../orders/order.ts';
import { formatMoney } from '../orders/pricing.ts';
import type { Shipment } from '../shipping/carrier.ts';
import type { Message } from './email.ts';

export type TemplateName = 'confirmed' | 'shipped';

export function confirmed(order: Order): Message {
  const lines = order.lines.map(
    (line) => `  ${line.quantity} x ${line.sku} at ${formatMoney(line.unitPrice)}`,
  );
  return {
    to: order.email,
    subject: `Order ${order.id} confirmed`,
    text: [
      `Thanks, ${order.address.name}. We have your order and will let you know when it ships.`,
      '',
      ...lines,
      '',
      `Total charged: ${formatMoney(order.total)}`,
    ].join('\n'),
  };
}

export function shipped(order: Order, shipment: Shipment): Message {
  return {
    to: order.email,
    subject: `Order ${order.id} is on its way`,
    text: [
      `Your order has been handed to ${shipment.carrier}.`,
      `Tracking number: ${shipment.trackingNumber}`,
      '',
      `Delivering to ${order.address.line1}, ${order.address.city} ${order.address.postcode}.`,
    ].join('\n'),
  };
}
