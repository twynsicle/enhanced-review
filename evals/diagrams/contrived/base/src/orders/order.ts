export type OrderStatus = 'placed' | 'paid' | 'packing' | 'shipped' | 'cancelled';

export interface OrderLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  country: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  email: string;
  lines: OrderLine[];
  address: Address;
  total: number;
  paymentReference: string | null;
  refundReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ['paid', 'cancelled'],
  paid: ['packing', 'cancelled'],
  packing: ['shipped'],
  shipped: [],
  cancelled: [],
};

export class TransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  constructor(order: Order, to: OrderStatus) {
    super(`order ${order.id} cannot move from ${order.status} to ${to}`);
    this.name = 'TransitionError';
    this.from = order.status;
    this.to = to;
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(order: Order, to: OrderStatus, at: Date = new Date()): Order {
  if (!canTransition(order.status, to)) throw new TransitionError(order, to);
  return { ...order, status: to, updatedAt: at };
}
