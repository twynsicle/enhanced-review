import { useMemo } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import type { ReviewMeta } from '@/review/review-meta';

/**
 * Which chapters a reader has marked read, per review, in one localStorage key
 * holding JSON: `{ [reviewKey]: { read: chapterId[], at: epochMs } }`.
 *
 * Not a raw preference: it is a record of what someone did, not a setting, and
 * it holds many values. A review is keyed by its repository and its two
 * commits, so rendering the same range again finds the same progress; an id
 * no chapter has any more is ignored where it is read rather than cleaned up.
 *
 * Every storage call is caught. Storage that is blocked, full, missing or
 * holding something unreadable means no progress is kept, never a reader that
 * fails to open.
 */
export const PROGRESS_KEY = 'er-progress';

/** How many reviews are remembered; the least recently touched go first. */
export const MAX_REVIEWS = 50;

const ReviewProgressSchema = z.object({
  read: z.array(z.string()),
  at: z.number(),
});
export type ReviewProgress = z.infer<typeof ReviewProgressSchema>;
export type ProgressRecord = Readonly<Record<string, ReviewProgress>>;

export function reviewKey(meta: Pick<ReviewMeta, 'repo' | 'baseSha' | 'headSha'>): string {
  return `${meta.repo}|${meta.baseSha}|${meta.headSha}`;
}

/** The stored text as a record, keeping each review that reads and dropping any that does not. */
export function parseProgress(stored: string | null): ProgressRecord {
  if (stored === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => {
      const parsed = ReviewProgressSchema.safeParse(value);
      return parsed.success ? [[key, parsed.data] as const] : [];
    }),
  );
}

/** What storage holds, or null when storage itself cannot be read. */
function readStorage(): ProgressRecord | null {
  try {
    return parseProgress(window.localStorage.getItem(PROGRESS_KEY));
  } catch {
    return null;
  }
}

function writeStorage(record: ProgressRecord): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(record));
  } catch {
    /* private mode / quota: progress lasts as long as the page */
  }
}

export function loadProgress(): ProgressRecord {
  return readStorage() ?? {};
}

/** `record` with one chapter marked or unmarked, that review touched at `now`, and only the newest kept. */
export function withChapterRead(
  record: ProgressRecord,
  key: string,
  chapterId: string,
  read: boolean,
  now: number,
): ProgressRecord {
  const current = record[key]?.read ?? [];
  const next = read
    ? current.includes(chapterId)
      ? current
      : [...current, chapterId]
    : current.filter((id) => id !== chapterId);
  const entries: [string, ReviewProgress][] = [
    ...Object.entries(record).filter(([other]) => other !== key),
    [key, { read: next, at: now }],
  ];
  return Object.fromEntries(entries.toSorted(([, a], [, b]) => b.at - a.at).slice(0, MAX_REVIEWS));
}

interface ProgressState {
  reviews: ProgressRecord;
  setRead: (key: string, chapterId: string, read: boolean) => void;
}

export const useProgress = create<ProgressState>()((set, get) => ({
  reviews: loadProgress(),
  setRead: (key, chapterId, read) => {
    // Other reviews come from what storage holds now, so one open in another
    // tab keeps what it wrote meanwhile; this review comes from memory, which
    // holds every mark made here even when storage refused to take one.
    const stored = readStorage();
    const mine = get().reviews[key];
    const base = stored === null ? get().reviews : mine ? { ...stored, [key]: mine } : stored;
    const reviews = withChapterRead(base, key, chapterId, read, Date.now());
    writeStorage(reviews);
    set({ reviews });
  },
}));

const NONE: readonly string[] = [];

/** The chapter ids marked read in one review. */
export function useReadChapters(key: string): ReadonlySet<string> {
  const read = useProgress((state) => state.reviews[key]?.read ?? NONE);
  return useMemo(() => new Set(read), [read]);
}
