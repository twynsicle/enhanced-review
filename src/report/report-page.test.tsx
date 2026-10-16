import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@/report/test/render';
import { ReportPage } from './report-page';
import { SAMPLE_BUNDLE } from './sample-bundle';

// The chapter view mounts the diff and excerpt editors, which would otherwise
// fetch Monaco from the CDN.
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div />,
  Editor: () => <div />,
  loader: { config: () => {}, init: () => Promise.resolve({ editor: { defineTheme: () => {} } }) },
}));

const header = () => screen.getAllByRole('banner')[0]!;
const summaryTitle = SAMPLE_BUNDLE.review.prTitle;

function renderAt(hash: string) {
  window.history.replaceState(null, '', hash);
  render(<ReportPage result={{ ok: true, bundle: SAMPLE_BUNDLE }} />);
  return within(header()).getByRole('link');
}

afterEach(() => {
  window.history.replaceState(null, '', '#/');
  vi.restoreAllMocks();
});

describe('the report header', () => {
  it('names the change and says where it goes', () => {
    const link = renderAt('#/');
    expect(link).toHaveAttribute('href', '#/');
    expect(link).toHaveTextContent('#42');
    expect(link).toHaveTextContent(summaryTitle);
    expect(link).toHaveAccessibleName(/back to the summary$/);
    expect(header()).not.toHaveTextContent('Local review');
  });

  it('takes a reader in a chapter back to the summary', async () => {
    const link = renderAt('#/?ch=cadence-table');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Due-date maths becomes a lookup table instead of a ternary.',
    );
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: summaryTitle })).toBeDefined();
  });

  it('scrolls to the top when the summary is already open', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    fireEvent.click(renderAt('#/'));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('names nothing when there is no review to read', () => {
    render(<ReportPage result={{ ok: false, reason: 'missing' }} />);
    expect(within(header()).queryByRole('link')).toBeNull();
  });
});
