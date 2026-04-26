import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightCallout } from './insight-callout';

describe('<InsightCallout />', () => {
  it('renders the editorial label and the insight text', () => {
    render(<InsightCallout insight={{ type: 'rationale', text: 'Why we did X' }} />);
    expect(screen.getByText(/Why this matters/)).toBeDefined();
    expect(screen.getByText('Why we did X')).toBeDefined();
  });

  it('renders a distinct label per insight type', () => {
    const cases = [
      { type: 'context', label: /Context worth knowing/ },
      { type: 'rationale', label: /Why this matters/ },
      { type: 'highlight', label: /Worth flagging/ },
      { type: 'reference', label: /For reference/ },
    ] as const;

    for (const { type, label } of cases) {
      const { unmount } = render(<InsightCallout insight={{ type, text: `${type} body` }} />);
      expect(screen.getByText(label)).toBeDefined();
      expect(screen.getByText(`${type} body`)).toBeDefined();
      unmount();
    }
  });
});
