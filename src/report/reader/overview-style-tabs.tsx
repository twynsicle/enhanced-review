import { Tabs } from '@mantine/core';
import type { ReactNode } from 'react';
import type { OverviewStyle, OverviewStyles } from '@/review/narrative';
import { isOverviewStyle } from '@/review/prompt/overview-styles';
import { useOverviewStyleChoice } from '@/report/stores/overview-style';

/** What each style's tab says; `tldr` is named for what it shows rather than its flag. */
const STYLE_NAMES: Record<OverviewStyle, string> = {
  narrative: 'Narrative',
  'before-after': 'Before/after',
  'five-whys': 'Five whys',
  plain: 'Plain',
  simple: 'Simple',
  'pros-cons': 'Pros/cons',
  tldr: 'Headlines only',
};

/**
 * The styles a review was written in, as tabs over the passage they restyle:
 * the overview on the summary, the body on a chapter. Over the text rather
 * than in the display menu, because which style is being read is a property of
 * the text in front of the reader, and a comparison means flipping it while
 * looking at it. The choice is one preference for the whole review, so a tab
 * picked on the summary is the one every chapter opens on.
 *
 * A review written in one style gets no tabs: a single tab is a control that
 * does nothing.
 */
export function OverviewStyleTabs({
  styles,
  shown,
  children,
}: {
  styles: OverviewStyles;
  /** The style the passage below is drawn in; see `useOverviewStyle`. */
  shown: OverviewStyle;
  children: ReactNode;
}) {
  const choose = useOverviewStyleChoice((s) => s.choose);
  if (styles.length < 2) return children;
  return (
    <Tabs
      value={shown}
      onChange={(value) => value !== null && isOverviewStyle(value) && choose(value)}
      keepMounted={false}
      styles={{ tab: { paddingInline: 10 } }}
    >
      <Tabs.List aria-label="Overview style">
        {styles.map((style) => (
          <Tabs.Tab key={style} value={style}>
            {STYLE_NAMES[style]}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {/* One panel, the shown style's: the passage is the same element whichever tab is up. */}
      <Tabs.Panel value={shown} pt={16}>
        {children}
      </Tabs.Panel>
    </Tabs>
  );
}
