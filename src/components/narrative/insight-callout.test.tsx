import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightCallout } from './insight-callout';

describe('<InsightCallout />', () => {
  it('uppercases the type label and renders the text', () => {
    render(<InsightCallout insight={{ type: 'rationale', text: 'Why we did X' }} />);
    expect(screen.getByText('RATIONALE')).toBeDefined();
    expect(screen.getByText('Why we did X')).toBeDefined();
  });

  it('handles each insight type', () => {
    const types = ['context', 'rationale', 'highlight', 'reference'] as const;
    for (const t of types) {
      const { unmount } = render(<InsightCallout insight={{ type: t, text: t }} />);
      expect(screen.getByText(t.toUpperCase())).toBeDefined();
      unmount();
    }
  });
});
