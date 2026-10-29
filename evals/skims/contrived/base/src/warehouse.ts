import type { Adjustment, StockLevel, Warehouse } from './sync/reconcile.ts';

/**
 * The warehouse system's stock table, behind the two calls the sync needs.
 * The real client lives in the warehouse package; this is the seam the
 * service is tested through.
 */
export async function openWarehouse(): Promise<Warehouse> {
  const { WarehouseClient } = await import('@acme/warehouse-client');
  const client = new WarehouseClient({ dsn: process.env.WAREHOUSE_DSN });
  return {
    levels: async (): Promise<StockLevel[]> => {
      const rows = await client.query('select sku, depot, quantity from stock');
      return rows.map((row) => ({ sku: row.sku, depot: row.depot, quantity: row.quantity }));
    },
    apply: async (adjustments: Adjustment[]): Promise<void> => {
      await client.transaction(async (tx) => {
        for (const adj of adjustments) {
          await tx.execute('update stock set quantity = ? where sku = ? and depot = ?', [
            adj.to,
            adj.sku,
            adj.depot,
          ]);
        }
      });
    },
  };
}
