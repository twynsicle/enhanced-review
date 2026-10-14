import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@/report/test/render';
import { ReportPage } from './report-page';
import { SAMPLE_BUNDLE } from './sample-bundle';

describe('the report header', () => {
  it('names the change and links it to the summary', () => {
    render(<ReportPage result={{ ok: true, bundle: SAMPLE_BUNDLE }} />);
    const header = screen.getAllByRole('banner')[0]!;
    const link = within(header).getByRole('link');
    expect(link).toHaveAttribute('href', '#/');
    expect(link).toHaveTextContent('#42');
    expect(link).toHaveTextContent(SAMPLE_BUNDLE.review.prTitle);
    expect(header).not.toHaveTextContent('Local review');
  });

  it('names nothing when there is no review to read', () => {
    render(<ReportPage result={{ ok: false, reason: 'missing' }} />);
    expect(within(screen.getAllByRole('banner')[0]!).queryByRole('link')).toBeNull();
  });
});
