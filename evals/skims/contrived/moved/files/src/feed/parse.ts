import { lines, normaliseSku, quantityOf } from './cells.ts';

export interface FeedRow {
  sku: string;
  quantity: number;
  depot: string;
  updatedAt: string | null;
}

/** The five-column format the supplier has sent since 2023. */
export function parseFeed(text: string): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const line of lines(text)) {
    const cells = line.split(',');
    if (cells.length < 5) throw new Error(`expected five columns: ${line}`);
    const [sku, quantity, depot, , updatedAt] = cells;
    rows.push({
      sku: normaliseSku(sku!),
      quantity: quantityOf(quantity!),
      depot: depot!.trim(),
      updatedAt: updatedAt!.trim() || null,
    });
  }
  return rows;
}

/** The three-column format two depots still send, kept behind LEGACY_FEED. */
export function parseLegacyFeed(text: string): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const line of lines(text)) {
    const cells = line.split(';');
    if (cells.length !== 3) throw new Error(`expected three columns: ${line}`);
    const [sku, depot, quantity] = cells;
    rows.push({
      sku: normaliseSku(sku!),
      quantity: quantityOf(quantity!),
      depot: depot!.trim(),
      updatedAt: null,
    });
  }
  return rows;
}
