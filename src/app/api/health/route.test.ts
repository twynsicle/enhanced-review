import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface HealthRows {
  pendingCount?: number;
  oldestPendingCreated?: Date | null;
  errorCount?: number;
}

const rowsRef: { current: HealthRows } = vi.hoisted(() => ({
  current: {
    pendingCount: 3,
    oldestPendingCreated: new Date(Date.now() - 30_000),
    errorCount: 1,
  },
}));

// Mock the db client. Three queries run in parallel; we identify which
// builder a call belongs to by what `select()` was called with.
vi.mock('@/lib/db/client', () => {
  type Q = 'queueDepth' | 'oldestPending' | 'errorsLast24h';

  function chainFor(kind: Q) {
    const finalResult = (): unknown[] => {
      if (kind === 'queueDepth') return [{ n: rowsRef.current.pendingCount ?? 0 }];
      if (kind === 'errorsLast24h') return [{ n: rowsRef.current.errorCount ?? 0 }];
      const created = rowsRef.current.oldestPendingCreated;
      return created ? [{ createdAt: created }] : [];
    };

    const builder: Record<string, unknown> = {};
    builder.from = vi.fn(() => builder);
    builder.where = vi.fn(() => {
      if (kind === 'oldestPending') return builder;
      // For count queries the chain ends at .where (returns a Promise-like).
      return Promise.resolve(finalResult());
    });
    builder.orderBy = vi.fn(() => builder);
    builder.limit = vi.fn(() => Promise.resolve(finalResult()));
    return builder;
  }

  let countCallIndex = 0;

  return {
    db: {
      select: vi.fn((cols?: Record<string, unknown>) => {
        // The oldest-pending query selects `{ createdAt: ... }` whereas the
        // count queries select `{ n: ... }`.
        if (cols && 'createdAt' in cols) return chainFor('oldestPending');
        // Counts run in this order: queueDepth, then errorsLast24h.
        const kind: 'queueDepth' | 'errorsLast24h' =
          countCallIndex === 0 ? 'queueDepth' : 'errorsLast24h';
        countCallIndex += 1;
        return chainFor(kind);
      }),
      __resetCountCallIndex: () => {
        countCallIndex = 0;
      },
    },
  };
});

import { GET } from './route';
import { db } from '@/lib/db/client';

beforeEach(() => {
  rowsRef.current = {
    pendingCount: 3,
    oldestPendingCreated: new Date(Date.now() - 30_000),
    errorCount: 1,
  };
  (db as unknown as { __resetCountCallIndex: () => void }).__resetCountCallIndex();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/health', () => {
  it('returns ok=true with the queue snapshot', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.queueDepth).toBe(3);
    expect(body.errorsLast24h).toBe(1);
    expect(body.oldestPendingAgeSec).toBeGreaterThanOrEqual(29);
    expect(body.oldestPendingAgeSec).toBeLessThan(60);
  });

  it('reports null oldestPendingAgeSec when nothing is pending', async () => {
    rowsRef.current = { pendingCount: 0, oldestPendingCreated: null, errorCount: 0 };
    (db as unknown as { __resetCountCallIndex: () => void }).__resetCountCallIndex();
    const res = await GET();
    const body = await res.json();
    expect(body.oldestPendingAgeSec).toBeNull();
    expect(body.queueDepth).toBe(0);
  });
});
