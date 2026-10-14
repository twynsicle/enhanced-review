import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadProgress,
  MAX_REVIEWS,
  parseProgress,
  PROGRESS_KEY,
  reviewKey,
  useProgress,
  withChapterRead,
} from './progress';

const KEY = 'acme/widgets|aaa|bbb';

function stored(): unknown {
  const raw = window.localStorage.getItem(PROGRESS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('reading progress', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useProgress.setState({ reviews: {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keys a review by its repository and both commits', () => {
    expect(reviewKey({ repo: 'acme/widgets', baseSha: 'aaa', headSha: 'bbb' })).toBe(KEY);
    expect(reviewKey({ repo: 'acme/widgets', baseSha: 'aaa', headSha: 'ccc' })).not.toBe(KEY);
  });

  it('round-trips a mark through storage, so a reload finds it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    useProgress.getState().setRead(KEY, 'ch1', true);
    useProgress.getState().setRead(KEY, 'ch2', true);

    expect(stored()).toEqual({ [KEY]: { read: ['ch1', 'ch2'], at: 1000 } });
    expect(loadProgress()).toEqual({ [KEY]: { read: ['ch1', 'ch2'], at: 1000 } });
  });

  it('unmarks a chapter, and marking one twice holds it once', () => {
    useProgress.getState().setRead(KEY, 'ch1', true);
    useProgress.getState().setRead(KEY, 'ch1', true);
    expect(useProgress.getState().reviews[KEY]?.read).toEqual(['ch1']);

    useProgress.getState().setRead(KEY, 'ch1', false);
    expect(useProgress.getState().reviews[KEY]?.read).toEqual([]);
  });

  it('keeps what another tab wrote for another review', () => {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ other: { read: ['x'], at: 5 } }));
    useProgress.getState().setRead(KEY, 'ch1', true);
    expect(stored()).toMatchObject({ other: { read: ['x'], at: 5 }, [KEY]: { read: ['ch1'] } });
  });

  it(`keeps the ${String(MAX_REVIEWS)} most recently touched reviews and evicts the oldest`, () => {
    let record = {};
    for (let i = 0; i < MAX_REVIEWS; i++) {
      record = withChapterRead(record, `review-${String(i)}`, 'ch1', true, 100 + i);
    }
    // Touching the oldest makes it the newest, so the next oldest is the one to go.
    record = withChapterRead(record, 'review-0', 'ch2', true, 1000);
    record = withChapterRead(record, 'review-new', 'ch1', true, 1001);

    const keys = Object.keys(record);
    expect(keys).toHaveLength(MAX_REVIEWS);
    expect(keys).toContain('review-0');
    expect(keys).toContain('review-new');
    expect(keys).not.toContain('review-1');
  });

  it('reads nothing stored, or anything unreadable, as no progress', () => {
    expect(parseProgress(null)).toEqual({});
    expect(parseProgress('{not json')).toEqual({});
    expect(parseProgress('[1, 2]')).toEqual({});
    expect(parseProgress('"read"')).toEqual({});
    expect(parseProgress('null')).toEqual({});
  });

  it('keeps each review that reads and drops one that does not', () => {
    const raw = JSON.stringify({
      good: { read: ['ch1'], at: 3 },
      noTime: { read: ['ch1'] },
      notList: { read: 'ch1', at: 3 },
      notIds: { read: [1, 2], at: 3 },
    });
    expect(parseProgress(raw)).toEqual({ good: { read: ['ch1'], at: 3 } });
  });

  it('keeps every mark made here when storage reads but refuses to write', () => {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ other: { read: ['x'], at: 5 } }));
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    useProgress.getState().setRead(KEY, 'ch1', true);
    useProgress.getState().setRead(KEY, 'ch2', true);
    expect(useProgress.getState().reviews[KEY]?.read).toEqual(['ch1', 'ch2']);
    expect(useProgress.getState().reviews.other).toEqual({ read: ['x'], at: 5 });

    useProgress.getState().setRead(KEY, 'ch1', false);
    expect(useProgress.getState().reviews[KEY]?.read).toEqual(['ch2']);
  });

  it('starts empty and still marks in memory when storage throws', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadProgress()).toEqual({});

    useProgress.getState().setRead(KEY, 'ch1', true);
    useProgress.getState().setRead(KEY, 'ch2', true);
    expect(useProgress.getState().reviews[KEY]?.read).toEqual(['ch1', 'ch2']);
  });
});
