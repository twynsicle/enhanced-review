import type { Order, OrderStatus } from '../orders/order.ts';
import type { Shipment } from '../shipping/carrier.ts';

export interface Store {
  ensureTable(name: string): Promise<void>;
  ensureIndex(table: string, field: string): Promise<void>;
  appliedMigrations(): Promise<string[]>;
  recordMigration(name: string, ranAt: Date): Promise<void>;
  getOrder(id: string): Promise<Order | null>;
  putOrder(order: Order): Promise<void>;
  listOrders(status: OrderStatus): Promise<Order[]>;
  getShipment(orderId: string): Promise<Shipment | null>;
  putShipment(shipment: Shipment): Promise<void>;
}

export class MemoryStore implements Store {
  private readonly tables = new Map<string, Map<string, unknown>>();

  constructor() {
    // The one table no migration can create, since it is where migrations are recorded.
    this.tables.set('migrations', new Map());
  }

  private table<T>(name: string): Map<string, T> {
    const table = this.tables.get(name);
    if (!table) throw new Error(`table ${name} does not exist; have the migrations run?`);
    return table as Map<string, T>;
  }

  ensureTable(name: string): Promise<void> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return Promise.resolve();
  }

  ensureIndex(table: string, _field: string): Promise<void> {
    this.table(table);
    return Promise.resolve();
  }

  appliedMigrations(): Promise<string[]> {
    return Promise.resolve([...this.table<Date>('migrations').keys()]);
  }

  recordMigration(name: string, ranAt: Date): Promise<void> {
    this.table<Date>('migrations').set(name, ranAt);
    return Promise.resolve();
  }

  getOrder(id: string): Promise<Order | null> {
    return Promise.resolve(this.table<Order>('orders').get(id) ?? null);
  }

  putOrder(order: Order): Promise<void> {
    this.table<Order>('orders').set(order.id, order);
    return Promise.resolve();
  }

  listOrders(status: OrderStatus): Promise<Order[]> {
    const orders = [...this.table<Order>('orders').values()];
    return Promise.resolve(orders.filter((order) => order.status === status));
  }

  getShipment(orderId: string): Promise<Shipment | null> {
    return Promise.resolve(this.table<Shipment>('shipments').get(orderId) ?? null);
  }

  putShipment(shipment: Shipment): Promise<void> {
    this.table<Shipment>('shipments').set(shipment.orderId, shipment);
    return Promise.resolve();
  }
}

export class OrderNotFound extends Error {
  constructor(id: string) {
    super(`no order ${id}`);
    this.name = 'OrderNotFound';
  }
}

export async function requireOrder(store: Store, id: string): Promise<Order> {
  const order = await store.getOrder(id);
  if (!order) throw new OrderNotFound(id);
  return order;
}

/** The one store the service and the CLI open. */
export function openStore(): Store {
  return new MemoryStore();
}
