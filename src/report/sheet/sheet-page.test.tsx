import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { REAL_ARCHITECTURE, REAL_STATE } from '@/report/test/diagram-fixtures';
import { fireEvent, render } from '@/report/test/render';
import {
  injectSheet,
  readEmbeddedSheet,
  SHEET_ELEMENT_ID,
  SHEET_PLACEHOLDER,
  type ContactSheet,
} from './sheet-data';
import { SheetPage } from './sheet-page';
import { ratingsFile, SHEET_RATINGS_KEY, useSheetRatings } from './sheet-ratings';

const sheet: ContactSheet = {
  sweeps: [
    { stamp: '20261030-221500', summary: "er's default model, 1 branches × 2 samples, $1.90" },
  ],
  branches: [
    {
      name: 'retry-queue',
      title: 'Retry a capture the gateway failed',
      deserves: 'overview architecture, chapter diagrams 0–1 sequence',
      question: 'Where does a failed capture go?',
      mustName: ['a gateway error queues a retry'],
      mustReach: ['src/worker/worker.ts'],
      bands: [
        [
          {
            sample: 1,
            href: 'retry-queue/sample-1/review.html',
            failure: null,
            onTarget: false,
            verdict: 'off  ·  overview architecture  ·  chapters state ✗',
            figures: '10 nodes  ·  unchanged 30%',
            diagrams: [
              {
                where: 'overview',
                diagram: REAL_ARCHITECTURE,
                judgements: [
                  { judge: 'judge-a', rating: 'usable', reason: 'The sweep is implied.' },
                  { judge: 'judge-b', rating: null, reason: 'no block' },
                ],
              },
              { where: 'Retry sweep', diagram: REAL_STATE, judgements: [] },
            ],
          },
          {
            sample: 2,
            href: null,
            failure: 'error </script> the model never answered',
            onTarget: false,
            verdict: 'FAILED (er exited 1)',
            figures: '',
            diagrams: [],
          },
        ],
      ],
    },
  ],
};

describe('SheetPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSheetRatings.setState({ ratings: {} });
  });

  it('shows each branch under its tab with what it deserves, and each sample’s verdict, diagrams and review link', () => {
    render(<SheetPage result={{ ok: true, sheet }} />);
    expect(screen.getByRole('tab', { name: 'retry-queue 0/1 rated' })).toBeTruthy();
    const row = screen.getByRole('region', { name: 'retry-queue' });
    expect(within(row).getByText('Where does a failed capture go?', { exact: false })).toBeTruthy();
    expect(within(row).getByText('src/worker/worker.ts')).toBeTruthy();

    const first = within(row).getByRole('article', { name: 'sample 1' });
    expect(within(first).getByText(/chapters state/)).toBeTruthy();
    expect(within(first).getAllByRole('img')).toHaveLength(2);
    expect(within(first).getByText('Retry sweep')).toBeTruthy();
    expect(within(first).getByRole('link', { name: 'Open the review' }).getAttribute('href')).toBe(
      'retry-queue/sample-1/review.html',
    );

    const second = within(row).getByRole('article', { name: 'sample 2' });
    expect(within(second).getByText(/the model never answered/)).toBeTruthy();
    expect(within(second).queryByRole('link')).toBeNull();
  });

  it('rates an overview, takes a rating back on a second click, and offers the ratings for download', () => {
    render(<SheetPage result={{ ok: true, sheet }} />);
    const first = screen.getByRole('article', { name: 'sample 1' });
    const usable = within(first).getByRole('button', { name: 'usable' });
    expect(screen.getByRole('button', { name: 'Download ratings (0)' })).toBeDisabled();

    fireEvent.click(usable);
    expect(usable.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Download ratings (1)' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'retry-queue 1/1 rated' })).toBeTruthy();
    expect(ratingsFile(useSheetRatings.getState().ratings, ['20261030-221500'])).toEqual({
      ratings: [{ stamp: '20261030-221500', branch: 'retry-queue', sample: 1, rating: 'usable' }],
    });
    expect(window.localStorage.getItem(SHEET_RATINGS_KEY)).toContain('"usable"');

    fireEvent.click(usable);
    expect(usable.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Download ratings (0)' })).toBeDisabled();
  });

  it('keeps the judges’ verdicts hidden until asked for', () => {
    render(<SheetPage result={{ ok: true, sheet }} />);
    expect(screen.queryByText(/The sweep is implied/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show the judges' }));
    expect(screen.getByText(/The sweep is implied/)).toBeTruthy();
    expect(screen.getByText('unreadable')).toBeTruthy();
  });

  it('downloads only the ratings of the sweeps the sheet shows', () => {
    const ratings = {
      a: { stamp: 'shown', branch: 'b', sample: 2, rating: 'good' as const },
      b: { stamp: 'other', branch: 'b', sample: 1, rating: 'poor' as const },
      c: { stamp: 'shown', branch: 'a', sample: 1, rating: 'poor' as const },
    };
    expect(ratingsFile(ratings, ['shown']).ratings.map((item) => item.branch)).toEqual(['a', 'b']);
  });

  it('says so when the page carries no sheet', () => {
    render(<SheetPage result={readEmbeddedSheet('')} />);
    expect(screen.getByText('This page carries no contact sheet.')).toBeTruthy();
  });
});

describe('injectSheet', () => {
  it('fills the placeholder so the page reads the same sheet back, a closing script tag in it included', () => {
    const html = `<body>${SHEET_PLACEHOLDER}</body>`;
    const filled = injectSheet(html, sheet);
    const text = new DOMParser()
      .parseFromString(filled, 'text/html')
      .getElementById(SHEET_ELEMENT_ID)?.textContent;
    const read = readEmbeddedSheet(text);
    expect(read.ok && read.sheet.branches[0]?.bands[0]?.[1]?.failure).toBe(
      'error </script> the model never answered',
    );
  });

  it('refuses a page without exactly one placeholder', () => {
    expect(() => injectSheet('<body></body>', sheet)).toThrow('expected exactly one');
  });
});
