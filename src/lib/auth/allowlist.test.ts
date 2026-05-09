import { describe, expect, it, vi, beforeEach } from 'vitest';

const limitMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: limitMock })),
      })),
    })),
  },
}));

import { isAllowed } from './allowlist';

beforeEach(() => {
  limitMock.mockReset();
});

describe('isAllowed', () => {
  it('returns true when a row is found', async () => {
    limitMock.mockResolvedValueOnce([{ id: 'allow-1' }]);
    expect(await isAllowed('twynsicle')).toBe(true);
  });

  it('returns false when no row is found', async () => {
    limitMock.mockResolvedValueOnce([]);
    expect(await isAllowed('someone-else')).toBe(false);
  });

  it('returns false when github login is empty (no DB call)', async () => {
    expect(await isAllowed('')).toBe(false);
    expect(limitMock).not.toHaveBeenCalled();
  });

  it('fails closed (false) on unexpected errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    limitMock.mockRejectedValueOnce(new Error('boom'));
    expect(await isAllowed('twynsicle')).toBe(false);
    errSpy.mockRestore();
  });
});
