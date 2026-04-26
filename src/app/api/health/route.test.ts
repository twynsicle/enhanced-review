import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pb', () => ({
  pbAdmin: vi.fn(),
}));

import { GET } from './route';
import { pbAdmin } from '@/lib/pb';

const pbAdminMock = vi.mocked(pbAdmin);

interface HealthRows {
  pendingCount?: number;
  oldestPendingCreated?: string | null;
  errorCount?: number;
}

function fakePb(rows: HealthRows) {
  // Each handler builds its own getList call; we discriminate by the
  // filter string passed in `options` so a single mock can serve all
  // three. The route reads `totalItems` for counts and `items[0]` for
  // the oldest-pending lookup.
  return {
    collection: vi.fn(() => ({
      getList: vi.fn(
        (page: number, perPage: number, options: { filter?: string; sort?: string }) => {
          const filter = options.filter ?? '';
          if (filter.includes('completed_at')) {
            return Promise.resolve({
              page,
              perPage,
              totalItems: rows.errorCount ?? 0,
              totalPages: 1,
              items: [],
            });
          }
          if (options.sort === 'created') {
            return Promise.resolve({
              page,
              perPage,
              totalItems: rows.oldestPendingCreated ? 1 : 0,
              totalPages: 1,
              items: rows.oldestPendingCreated ? [{ created: rows.oldestPendingCreated }] : [],
            });
          }
          return Promise.resolve({
            page,
            perPage,
            totalItems: rows.pendingCount ?? 0,
            totalPages: 1,
            items: [],
          });
        },
      ),
    })),
  } as unknown as Awaited<ReturnType<typeof pbAdmin>>;
}

beforeEach(() => {
  pbAdminMock.mockResolvedValue(
    fakePb({
      pendingCount: 3,
      oldestPendingCreated: new Date(Date.now() - 30_000).toISOString(),
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
    pbAdminMock.mockResolvedValue(
      fakePb({ pendingCount: 0, oldestPendingCreated: null, errorCount: 0 }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.oldestPendingAgeSec).toBeNull();
    expect(body.queueDepth).toBe(0);
  });
});
