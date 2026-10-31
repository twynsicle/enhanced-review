import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REAL_ARCHITECTURE, REAL_STATE } from '@/report/test/diagram-fixtures';
import { render } from '@/report/test/render';
import {
  injectSheet,
  readEmbeddedSheet,
  SHEET_ELEMENT_ID,
  SHEET_PLACEHOLDER,
  type ContactSheet,
} from './sheet-data';
import { SheetPage } from './sheet-page';

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
              { where: 'overview', diagram: REAL_ARCHITECTURE },
              { where: 'Retry sweep', diagram: REAL_STATE },
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
  it('shows each branch with what it deserves, and each sample’s verdict, diagrams and review link', () => {
    render(<SheetPage result={{ ok: true, sheet }} />);
    const row = screen.getByRole('region', { name: 'retry-queue' });
    expect(within(row).getByText('Where does a failed capture go?', { exact: false })).toBeTruthy();
    expect(within(row).getByText('src/worker/worker.ts')).toBeTruthy();

    const first = within(row).getByRole('article', { name: 'sample 1' });
    expect(within(first).getByText(/chapters state/)).toBeTruthy();
    expect(within(first).getAllByRole('img')).toHaveLength(2);
    expect(within(first).getByRole('link', { name: 'Open the review' }).getAttribute('href')).toBe(
      'retry-queue/sample-1/review.html',
    );

    const second = within(row).getByRole('article', { name: 'sample 2' });
    expect(within(second).getByText(/the model never answered/)).toBeTruthy();
    expect(within(second).queryByRole('link')).toBeNull();
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
