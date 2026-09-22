import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/review/bundle';
import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { fireEvent, render, screen, waitFor } from '@/report/test/render';
import { TOPBAR_HEIGHT } from '@/report/theme/tokens';
import { ChapterReader } from './chapter-reader';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  loader: { config: () => {}, init: () => Promise.resolve({}) },
}));

const meta: ReviewMeta = {
  repo: 'acme/widgets',
  title: 'Add scheduled reviews',
  prNumber: 7,
  baseRefName: null,
  headRefName: null,
  authorLogin: 'someone',
  description: null,
  stats: null,
};

const FILES = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

const review: NarrativeReview = {
  prTitle: 'Add scheduled reviews',
  overviewSummary: { lede: 'The scheduler runs reviews on a cadence.' },
  chapters: [
    {
      id: 'ch1',
      title: 'Shape of the change',
      insights: [],
      diffChunks: FILES.map((filename) => ({ filename, language: 'typescript', hunks: [] })),
    },
  ],
  files: FILES.map((filename) => ({
    filename,
    status: 'modified' as const,
    additions: 1,
    deletions: 1,
  })),
};

const bundle: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-19T00:00:00.000Z',
  meta,
  review,
  files: {},
};

/**
 * Put each diff card at a chosen distance from the top of the viewport. Nothing
 * in happy-dom lays anything out, so the one input the hook reads is stubbed
 * directly; `tops` is per file, in the order `FILES` declares them.
 */
function placeCards(tops: readonly number[]): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-diff-file]');
  cards.forEach((card, index) => {
    const top = tops[index] ?? 0;
    card.getBoundingClientRect = () => ({ top, bottom: top + 400 }) as DOMRect;
  });
}

function rowFor(filename: string): HTMLElement {
  const basename = (filename.split('/').pop() ?? filename).replaceAll('.', String.raw`\.`);
  return screen.getByRole('button', { name: new RegExp(basename) });
}

/** Which changed-file row the sidebar marks as the one being read, if any. */
function markedRow(): string | null {
  return document.querySelector('[data-reading]')?.textContent ?? null;
}

function renderReader() {
  // The reader opens on the summary unless the hash names a chapter, and only a
  // chapter draws diff cards.
  window.location.hash = '#/?ch=ch1';
  render(
    <EmbeddedFileSource bundle={bundle}>
      <ChapterReader review={review} meta={meta} initialActiveId="ch1" />
    </EmbeddedFileSource>,
  );
}

function scrollTo(tops: readonly number[]): void {
  placeCards(tops);
  fireEvent.scroll(window);
}

describe('the file the reader is scrolled to', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('marks the file whose header is pinned, and nothing above the first diff', async () => {
    renderReader();
    // Every card still below the topbar: the reader is in the chapter's prose.
    scrollTo([500, 900, 1300]);
    await waitFor(() => {
      expect(markedRow()).toBeNull();
    });

    // The first card's top has gone under the topbar, so its header is the one
    // stuck there.
    scrollTo([TOPBAR_HEIGHT - 1, 400, 800]);
    await waitFor(() => {
      expect(rowFor('a.ts')).toHaveAttribute('data-reading');
    });
    expect(rowFor('b.ts')).not.toHaveAttribute('data-reading');

    // Two cards past the line: the lower one is the one pinned.
    scrollTo([-600, -200, 300]);
    await waitFor(() => {
      expect(rowFor('b.ts')).toHaveAttribute('data-reading');
    });
    expect(rowFor('a.ts')).not.toHaveAttribute('data-reading');
    expect(rowFor('c.ts')).not.toHaveAttribute('data-reading');
  });

  /*
   * The gap between two cards belongs to the card above it. Blinking the mark
   * off for the height of a margin is worse than being a card behind for it.
   */
  it('keeps the mark on the card above while the gap between two crosses the line', async () => {
    renderReader();
    // `a` has scrolled entirely past the line and `b` has not reached it yet.
    scrollTo([-460, 100, 520]);
    await waitFor(() => {
      expect(rowFor('a.ts')).toHaveAttribute('data-reading');
    });
    expect(rowFor('b.ts')).not.toHaveAttribute('data-reading');
  });
});
