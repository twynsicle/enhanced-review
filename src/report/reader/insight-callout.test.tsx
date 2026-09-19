import { describe, expect, it } from 'vitest';
import { render, screen } from '@/report/test/render';
import { InsightCallout, JudgementCallout } from './insight-callout';

describe('<InsightCallout />', () => {
  it('renders the editorial label and the insight text', () => {
    render(<InsightCallout insight={{ type: 'rationale', text: 'Why we did X' }} />);
    expect(screen.getByText(/Reasoning/)).toBeDefined();
    expect(screen.getByText('Why we did X')).toBeDefined();
  });

  it('renders a distinct label per insight type', () => {
    const cases = [
      { type: 'context', label: /Context/ },
      { type: 'rationale', label: /Reasoning/ },
      { type: 'highlight', label: /Risk/ },
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

describe('<JudgementCallout />', () => {
  it('labels the question and renders its title and text', () => {
    render(
      <JudgementCallout
        call={{
          title: 'Hourly cadence offered to every repo',
          text: 'Cheap if few choose it, 24x the work if most do.',
          filename: 'src/scheduler/cadence.ts',
          hunkIds: ['H0003'],
        }}
      />,
    );
    expect(screen.getByText(/Judgement call/)).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Hourly cadence offered to every repo' }),
    ).toBeDefined();
    expect(screen.getByText('Cheap if few choose it, 24x the work if most do.')).toBeDefined();
  });
});
