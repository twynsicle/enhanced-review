import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/report/test/render';
import { ReportRoot } from './report-root';

const BOOM = 'the reader threw on purpose';

vi.mock('./report-page', () => ({
  ReportPage: () => {
    throw new Error(BOOM);
  },
}));

// React logs a caught error, which is where the detail is meant to end up. Silenced so a passing run is quiet; the assertions below are
// about what the page shows, not what the console holds.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderReport() {
  render(<ReportRoot result={{ ok: false, reason: 'missing' }} />);
}

describe('the report root', () => {
  it('catches a throw from the page rather than leaving it blank', () => {
    renderReport();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      "This review can't be displayed",
    );
  });

  it('shows the reader nothing taken from the error', () => {
    renderReport();
    // A message carries whatever the thrower put in it and a stack always
    // carries paths; neither is the recipient's to read. Both are in the
    // console for whoever generated the file.
    const page = screen.getByRole('main').textContent ?? '';
    expect(page).not.toContain(BOOM);
    expect(page).not.toMatch(/\bat \S+:\d+:\d+/);
  });
});
