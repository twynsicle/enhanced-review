import { beforeEach, describe, expect, it } from 'vitest';
import type { OverviewStyles, Prose } from '@/review/narrative';
import { OverviewStyleTabs } from '@/report/reader/overview-style-tabs';
import { ProsePassage } from '@/report/reader/prose-passage';
import { render, screen, userEvent } from '@/report/test/render';
import {
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
});

const prose: Prose = {
  lede: 'The lede.',
  bodies: { narrative: 'The story.', simple: 'Short words.' },
};

/** What the reader does with the choice: the overview in the style shown, under its tabs. */
function Overview({ styles }: { styles: OverviewStyles }) {
  const shown = useOverviewStyle(styles);
  return (
    <OverviewStyleTabs styles={styles} shown={shown}>
      <ProsePassage prose={prose} bodyStyle={shown} />
    </OverviewStyleTabs>
  );
}

describe('the overview style tabs', () => {
  it('switch the body read to whichever of the review’s styles is picked', async () => {
    render(<Overview styles={['narrative', 'simple', 'tldr']} />);
    expect(screen.getByText('The story.')).toBeDefined();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Narrative', 'Simple', 'Headlines only']);
    expect(screen.getByRole('tab', { name: 'Narrative' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Headlines only' }));
    expect(screen.queryByText('The story.')).toBeNull();
    expect(screen.getByText('The lede.')).toBeDefined();
    expect(useOverviewStyleChoice.getState().chosen).toBe('tldr');

    await userEvent.click(screen.getByRole('tab', { name: 'Simple' }));
    expect(screen.getByText('Short words.')).toBeDefined();
  });

  it('are not drawn for a review written in one style', () => {
    render(<Overview styles={['simple']} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Short words.')).toBeDefined();
  });
});
