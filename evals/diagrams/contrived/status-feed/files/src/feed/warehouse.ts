import type { OrderStatus } from '../orders/order.ts';

/** One move of one order, as Shelfwise takes it. */
export interface StatusEvent {
  orderId: string;
  status: OrderStatus;
  at: string;
}

export interface Warehouse {
  send(event: StatusEvent): Promise<void>;
}

export class WarehouseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WarehouseError';
  }
}

export class ShelfwiseWarehouse implements Warehouse {
  private readonly url: string;
  private readonly key: string;
  private readonly timeoutMs: number;

  constructor(url: string, key: string, timeoutMs: number) {
    this.url = url;
    this.key = key;
    this.timeoutMs = timeoutMs;
  }

  async send(event: StatusEvent): Promise<void> {
    let response: Response;
    try {
      response = await fetch(new URL('/order-events', this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new WarehouseError(`Shelfwise unreachable: ${(error as Error).message}`);
    }
    if (!response.ok) throw new WarehouseError(`Shelfwise returned ${response.status}`);
  }
}
