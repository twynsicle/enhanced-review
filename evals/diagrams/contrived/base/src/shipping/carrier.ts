import type { Address } from '../orders/order.ts';

export interface BookingRequest {
  orderId: string;
  to: Address;
  pieces: number;
}

export interface Shipment {
  orderId: string;
  carrier: string;
  trackingNumber: string;
  bookedAt: Date;
}

export interface Carrier {
  readonly name: string;
  book(request: BookingRequest): Promise<string>;
}

export class CarrierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarrierError';
  }
}
