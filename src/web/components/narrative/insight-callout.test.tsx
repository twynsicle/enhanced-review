import { describe, expect, it } from 'vitest';
import { render, screen } from '@/web/test/render';
import { InsightCallout } from './insight-callout';

describe('<InsightCallout />', () => {
  it('renders the editorial label and the insight text', () => {
    render(<InsightCallout insight={{ type: 'rationale', text: 'Why we did X' }} />);
    expect(screen.getByText(/Praise/)).toBeDefined();
    expect(screen.getByText('Why we did X')).toBeDefined();
  });

  it('renders a distinct label per insight type', () => {
    const cases = [
      { type: 'context', label: /Context/ },
      { type: 'rationale', label: /Praise/ },
      { type: 'highlight', label: /Risk/ },
      { type: 'reference', label: /Suggestion/ },
    ] as const;

    for (const { type, label } of cases) {
      const { unmount } = render(<InsightCallout insight={{ type, text: `${type} body` }} />);
      expect(screen.getByText(label)).toBeDefined();
      expect(screen.getByText(`${type} body`)).toBeDefined();
      unmount();
    }
  });

  it('renders the optional title above the body when present', () => {
    render(
      <InsightCallout
        insight={{ type: 'highlight', title: 'Buffer can grow unbounded', text: 'Long story…' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Buffer can grow unbounded' })).toBeDefined();
    expect(screen.getByText('Long story…')).toBeDefined();
  });
});
