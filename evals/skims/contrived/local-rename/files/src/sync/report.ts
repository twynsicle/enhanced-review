import type { ReconcileResult } from './reconcile.ts';

export interface SyncReport {
  changed: number;
  unchanged: number;
  unknown: number;
  largest: { sku: string; depot: string; by: number } | null;
}

export function summarise(result: ReconcileResult): SyncReport {
  let largest: SyncReport['largest'] = null;
  for (const adjustment of result.adjustments) {
    const magnitude = Math.abs(adjustment.to - adjustment.from);
    if (!largest || magnitude > largest.by) {
      largest = { sku: adjustment.sku, depot: adjustment.depot, by: magnitude };
    }
  }
  return {
    changed: result.adjustments.length,
    unchanged: result.unchanged,
    unknown: result.unknown.length,
    largest,
  };
}
