import { describe, expect, it } from 'vitest';
import type { Phase, PhaseState } from '@/web/components/jobs/live-phases';
import { render, screen } from '@/web/test/render';
import { JobTimeline } from './job-timeline';

const phase = (id: string, state: PhaseState): Phase => ({
  id,
  label: `Phase ${id}`,
  detail: 'Something happened.',
  state,
});

function markerFor(state: PhaseState): string {
  render(<JobTimeline phases={[phase('p1', state)]} />);
  const marker = document.querySelector(`[data-state='${state}']`);
  if (!marker) throw new Error(`no marker for ${state}`);
  return marker.textContent ?? '';
}

describe('JobTimeline', () => {
  it('puts nothing but list items in the live region', () => {
    render(
      <JobTimeline phases={[phase('p1', 'done'), phase('p2', 'active'), phase('p3', 'pending')]} />,
    );
    const list = screen.getByRole('list');

    // An `ol` may hold only `li`s, and this one is the `aria-live` region
    // assistive technology walks on every phase change. The rail is drawn by
    // the stylesheet rather than by a node sitting among the phases.
    expect(list.getAttribute('aria-live')).toBe('polite');
    expect([...list.children].map((child) => child.tagName)).toEqual(['LI', 'LI', 'LI']);
  });

  it('marks a cancelled phase apart from one still pending', () => {
    // They shared the empty glyph, and cancelled wore the palette of a phase
    // that finished — so a stopped run read as a completed one.
    expect(markerFor('pending')).toBe('');
    expect(markerFor('cancelled')).toBe('–');
    expect(markerFor('done')).toBe('✓');
  });
});
