import type { ReconcileResult } from './reconcile.ts';

export interface SyncReport {
  changed: number;
  unchanged: number;
  unknown: number;
  largest: { sku: string; depot: string; by: number } | null;
}

export function summarise(result: ReconcileResult): SyncReport {
  let largest: SyncReport['largest'] = null;
  for (const adj of result.adjustments) {
    const by = Math.abs(adj.to - adj.from);
    if (!largest || by > largest.by) largest = { sku: adj.sku, depot: adj.depot, by };
  }
  return {
    changed: result.adjustments.length,
    unchanged: result.unchanged,
    unknown: result.unknown.length,
    largest,
  };
}
