import { beforeEach, describe, expect, it } from 'vitest';
import type { OverviewStyles, Prose } from '@/review/narrative';
import { DisplayMenu } from '@/report/chrome/display-menu';
import { ProsePassage } from '@/report/reader/prose-passage';
import { render, screen, userEvent } from '@/report/test/render';
import {
  nextStyle,
  OVERVIEW_STYLE_KEY,
  shownStyle,
  useOverviewStyle,
  useOverviewStyleChoice,
} from './overview-style';

function chosenAfterRehydrate(stored: string | null) {
  if (stored === null) window.localStorage.removeItem(OVERVIEW_STYLE_KEY);
  else window.localStorage.setItem(OVERVIEW_STYLE_KEY, stored);
  void useOverviewStyleChoice.persist.rehydrate();
  return useOverviewStyleChoice.getState().chosen;
}

beforeEach(() => {
  window.localStorage.clear();
  useOverviewStyleChoice.setState({ chosen: null });
});

describe('the overview style preference', () => {
  it('has no choice when nothing, or nothing it knows, is stored', () => {
    expect(chosenAfterRehydrate(null)).toBeNull();
    expect(chosenAfterRehydrate('checklist')).toBeNull();
    expect(chosenAfterRehydrate('simple')).toBe('simple');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useOverviewStyleChoice.getState().choose('pros-cons');
    expect(window.localStorage.getItem(OVERVIEW_STYLE_KEY)).toBe('pros-cons');
  });

  it('shows the choice when the review was written in it, and the review’s first style when not', () => {
    const styles: OverviewStyles = ['plain', 'simple'];
    expect(shownStyle(styles, null)).toBe('plain');
    expect(shownStyle(styles, 'simple')).toBe('simple');
    expect(shownStyle(styles, 'pros-cons')).toBe('plain');
  });

  it('steps through the review’s own styles, back round to its first', () => {
    const styles: OverviewStyles = ['narrative', 'simple', 'tldr'];
    expect(nextStyle(styles, 'narrative')).toBe('simple');
    expect(nextStyle(styles, 'tldr')).toBe('narrative');
  });
});

const prose: Prose = {
  lede: 'The lede.',
  bodies: { narrative: 'The story.', simple: 'Short words.' },
};

/** What the reader does with the choice: the overview in the style shown. */
function Overview({ styles }: { styles: OverviewStyles }) {
  return <ProsePassage prose={prose} bodyStyle={useOverviewStyle(styles)} />;
}

async function styleRow(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
  return screen.findByRole('menuitem', { name: /^Overview style:/ });
}

describe('the display menu’s overview style', () => {
  it('switches the body read, through every style the review carries', async () => {
    const styles: OverviewStyles = ['narrative', 'simple', 'tldr'];
    render(
      <>
        <DisplayMenu styles={styles} />
        <Overview styles={styles} />
      </>,
    );
    expect(screen.getByText('The story.')).toBeDefined();

    const row = await styleRow();
    expect(row.getAttribute('aria-label')).toMatch(/^Overview style: Narrative/);
    await userEvent.click(row);
    expect(screen.getByText('Short words.')).toBeDefined();
    expect(screen.queryByText('The story.')).toBeNull();

    await userEvent.click(row);
    expect(row.getAttribute('aria-label')).toMatch(/^Overview style: Headlines only/);
    expect(screen.queryByText('Short words.')).toBeNull();
    expect(screen.getByText('The lede.')).toBeDefined();
  });

  it('is not offered for a review written in one style', async () => {
    render(<DisplayMenu styles={['simple']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    await screen.findByRole('menuitem', { name: /^Theme:/ });
    expect(screen.queryByRole('menuitem', { name: /^Overview style:/ })).toBeNull();
  });
});
