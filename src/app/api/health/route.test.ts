import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { GET } from './route';
import { createAdminClient } from '@/lib/supabase/admin';

const createAdminClientMock = vi.mocked(createAdminClient);

interface HealthRows {
  pendingCount?: number;
  oldestPendingCreatedAt?: string | null;
  errorCount?: number;
}

function fakeAdmin(rows: HealthRows) {
  // Each `from('review_jobs').select(...)` builds a fresh chain. We
  // discriminate by the chain calls: `.eq('status', 'pending')` followed
  // by either `.order().limit().maybeSingle()` (oldest pending lookup)
  // or count via { count: 'exact', head: true } (queue depth / errors).
  return {
    from: vi.fn().mockImplementation(() => {
      const eqStatus = vi.fn();
      const eqStatusReturn: Record<string, unknown> = {};

      // Order/limit chain (oldest pending).
      const limit = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: rows.oldestPendingCreatedAt
            ? { created_at: rows.oldestPendingCreatedAt }
            : null,
          error: null,
        }),
      });
      const order = vi.fn().mockReturnValue({ limit });
      eqStatusReturn.order = order;

      // Count chain (queue depth / errors). Differentiates by completed_at filter.
      const gteFn = vi.fn().mockResolvedValue({
        count: rows.errorCount ?? 0,
        error: null,
      });
      eqStatusReturn.gte = gteFn;

      // For the head-count variant: .eq('status','pending') resolves directly.
      eqStatusReturn.then = (resolve: (r: unknown) => unknown) =>
        resolve({ count: rows.pendingCount ?? 0, error: null });

      eqStatus.mockReturnValue(eqStatusReturn);
      return {
        select: vi.fn().mockReturnValue({ eq: eqStatus }),
      };
    }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => {
  createAdminClientMock.mockReturnValue(
    fakeAdmin({
      pendingCount: 3,
      oldestPendingCreatedAt: new Date(Date.now() - 30_000).toISOString(),
      errorCount: 1,
    }),
  );
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
    createAdminClientMock.mockReturnValue(
      fakeAdmin({ pendingCount: 0, oldestPendingCreatedAt: null, errorCount: 0 }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.oldestPendingAgeSec).toBeNull();
    expect(body.queueDepth).toBe(0);
  });
});
