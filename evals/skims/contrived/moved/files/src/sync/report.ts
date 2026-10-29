import type { Adjustment, ReconcileResult } from './reconcile.ts';

export interface SyncReport {
  changed: number;
  unchanged: number;
  unknown: number;
  largest: { sku: string; depot: string; by: number } | null;
}

export function summarise(result: ReconcileResult): SyncReport {
  return {
    changed: result.adjustments.length,
    unchanged: result.unchanged,
    unknown: result.unknown.length,
    largest: largestAdjustment(result.adjustments),
  };
}

export function largestAdjustment(adjustments: readonly Adjustment[]): SyncReport['largest'] {
  let largest: SyncReport['largest'] = null;
  for (const adj of adjustments) {
    const by = Math.abs(adj.to - adj.from);
    if (!largest || by > largest.by) largest = { sku: adj.sku, depot: adj.depot, by };
  }
  return largest;
}
