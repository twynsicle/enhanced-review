import type { FeedRow } from '../feed/parse.ts';
import { log } from '../logger.ts';
import { RunCounters } from './trace.ts';

export interface StockLevel {
  sku: string;
  depot: string;
  quantity: number;
}

export interface Adjustment {
  sku: string;
  depot: string;
  from: number;
  to: number;
}

export interface Warehouse {
  levels(): Promise<StockLevel[]>;
  apply(adjustments: Adjustment[]): Promise<void>;
}

export interface ReconcileResult {
  adjustments: Adjustment[];
  unchanged: number;
  unknown: string[];
}

/**
 * Brings the warehouse's levels in line with the feed. The feed is the source
 * of truth for quantities; the warehouse is the source of truth for which
 * SKUs exist, so a feed row for a SKU the warehouse has never heard of is
 * reported rather than created.
 */
export async function reconcile(
  feed: FeedRow[],
  warehouse: Warehouse,
  batchSize: number,
  trace: string,
): Promise<ReconcileResult> {
  const counters = new RunCounters();
  const current = await warehouse.levels();
  log.debug('reconcile: loaded levels', { trace, levels: current.length, rows: feed.length });
  const known = new Map<string, StockLevel>();
  for (const level of current) known.set(key(level.sku, level.depot), level);

  const adjustments: Adjustment[] = [];
  const unknown: string[] = [];
  let unchanged = 0;
  for (const row of feed) {
    const level = known.get(key(row.sku, row.depot));
    if (!level) {
      log.debug('reconcile: unknown sku', { trace, sku: row.sku, depot: row.depot });
      counters.add('unknown');
      unknown.push(row.sku);
      continue;
    }
    if (level.quantity < 0) {
      log.warn('reconcile: negative level, skipping', { trace, sku: row.sku, depot: row.depot });
      counters.add('skipped');
      continue;
    }
    const delta = row.quantity - level.quantity;
    if (delta === 0) {
      unchanged += 1;
      continue;
    }
    counters.add('adjusted');
    adjustments.push({ sku: row.sku, depot: row.depot, from: level.quantity, to: row.quantity });
  }

  for (let start = 0; start < adjustments.length; start += batchSize) {
    await warehouse.apply(adjustments.slice(start, start + batchSize));
    counters.add('batches');
  }
  log.info('reconcile: done', { trace, ...counters.snapshot(), unchanged });
  return { adjustments, unchanged, unknown };
}

function key(sku: string, depot: string): string {
  return `${depot}/${sku}`;
}
