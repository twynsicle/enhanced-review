import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_SCHEMA_VERSION } from '@/review/bundle';
import { RISK_SECTION_ID, SUMMARY_SECTION_ID, type NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { PROGRESS_KEY, reviewKey, useProgress } from '@/report/stores/progress';
import { fireEvent, render, screen, waitFor, within } from '@/report/test/render';
import { ChapterReader } from './chapter-reader';
import { sectionHeadingId } from './sections';

const meta: ReviewMeta = {
  repo: 'acme/widgets',
  kind: 'pr',
  title: 'Add scheduled reviews',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  prNumber: 7,
  baseRefName: null,
  headRefName: null,
  authorLogin: null,
  description: null,
  stats: null,
};
const KEY = reviewKey(meta);

const review: NarrativeReview = {
  prTitle: 'Add scheduled reviews',
  overviewSummary: { lede: 'The scheduler runs reviews on a cadence.' },
  riskAssessment: { score: 2, summary: 'Low.', rationale: 'Small.', factors: [] },
  chapters: [
    { id: 'ch1', title: 'The cadence table', insights: [], diffChunks: [] },
    { id: 'ch2', title: 'The queue', insights: [], diffChunks: [] },
  ],
};

function open(section: string | null): void {
  window.history.replaceState(null, '', section === null ? '#/' : `#/?ch=${section}`);
  render(
    <EmbeddedFileSource
      bundle={{
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        generatedAt: '2026-09-11T10:00:00.000Z',
        meta,
        review,
        files: {},
      }}
    >
      <ChapterReader review={review} meta={meta} initialActiveId={SUMMARY_SECTION_ID} />
    </EmbeddedFileSource>,
  );
}

const footer = () => screen.getByRole('contentinfo');
const readIds = () => useProgress.getState().reviews[KEY]?.read ?? [];

describe('the section footer', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useProgress.setState({ reviews: {} });
  });
  afterEach(() => {
    window.history.replaceState(null, '', '#/');
  });

  it('marks and unmarks a chapter with its Read checkbox', () => {
    open('ch1');
    const checkbox = within(footer()).getByRole('checkbox', { name: 'Read' });
    expect(checkbox).not.toBeChecked();
    expect(within(footer()).getByText('0 of 2 chapters read')).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(readIds()).toEqual(['ch1']);
    expect(within(footer()).getByText('1 of 2 chapters read')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toMatchObject({
      [KEY]: { read: ['ch1'] },
    });

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(readIds()).toEqual([]);
  });

  it('does not mark a chapter for being opened', () => {
    open('ch1');
    expect(readIds()).toEqual([]);
  });

  it('marks the chapter read on Next, moves on and focuses the next heading', async () => {
    open('ch1');
    fireEvent.click(within(footer()).getByRole('button', { name: 'Next: The queue' }));

    expect(readIds()).toEqual(['ch1']);
    expect(window.location.hash).toBe('#/?ch=ch2');
    const heading = screen.getByRole('heading', { level: 1, name: 'The queue' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('leads from the last chapter back to the summary, and says when all are read', async () => {
    useProgress.getState().setRead(KEY, 'ch1', true);
    open('ch2');
    expect(within(footer()).queryByRole('button', { name: /^Next/ })).toBeNull();

    fireEvent.click(within(footer()).getByRole('checkbox', { name: 'Read' }));
    expect(within(footer()).getByText('All 2 chapters read')).toBeInTheDocument();

    fireEvent.click(within(footer()).getByRole('button', { name: 'Back to summary' }));
    expect(window.location.hash).toBe('#/');
    await waitFor(() =>
      expect(document.activeElement?.id).toBe(sectionHeadingId(SUMMARY_SECTION_ID)),
    );
  });

  it('gives the summary and the risk section a Next button and nothing else', () => {
    open(RISK_SECTION_ID);
    expect(within(footer()).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(footer()).getByRole('button', { name: 'Next: Summary' }));

    expect(within(footer()).queryByRole('checkbox')).toBeNull();
    expect(within(footer()).queryByText(/chapters read/)).toBeNull();
    fireEvent.click(within(footer()).getByRole('button', { name: 'Next: The cadence table' }));
    expect(window.location.hash).toBe('#/?ch=ch1');
    // Neither synthesised section is a chapter to mark.
    expect(readIds()).toEqual([]);
  });

  it('counts only chapters this review still has', () => {
    useProgress.getState().setRead(KEY, 'gone', true);
    open('ch1');
    expect(within(footer()).getByText('0 of 2 chapters read')).toBeInTheDocument();
  });

  it('shares its marks with the sidebar', () => {
    open('ch1');
    fireEvent.click(within(footer()).getByRole('checkbox', { name: 'Read' }));
    const nav = screen.getByRole('navigation', { name: 'Review navigation' });
    expect(within(nav).getByText('1 of 2 chapters read')).toBeInTheDocument();
    expect(
      within(nav).getByRole('button', { name: /The cadence table.*read/ }),
    ).toBeInTheDocument();
  });
});
