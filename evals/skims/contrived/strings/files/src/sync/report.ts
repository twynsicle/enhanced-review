import type { ReconcileResult } from './reconcile.ts';

export interface SyncReport {
  changed: number;
  unchanged: number;
  unknown: number;
  largest: { sku: string; depot: string; by: number } | null;
  /** Items changed per depot, depots in name order. */
  byDepot: { depot: string; changed: number }[];
}

export function summarise(result: ReconcileResult): SyncReport {
  let largest: SyncReport['largest'] = null;
  const perDepot = new Map<string, number>();
  for (const adj of result.adjustments) {
    const by = Math.abs(adj.to - adj.from);
    if (!largest || by > largest.by) largest = { sku: adj.sku, depot: adj.depot, by };
    perDepot.set(adj.depot, (perDepot.get(adj.depot) ?? 0) + 1);
  }
  return {
    changed: result.adjustments.length,
    unchanged: result.unchanged,
    unknown: result.unknown.length,
    largest,
    byDepot: [...perDepot.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([depot, changed]) => ({ depot, changed })),
  };
}
