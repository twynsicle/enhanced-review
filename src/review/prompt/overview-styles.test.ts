import { describe, expect, it } from 'vitest';
import { OVERVIEW_STYLES } from '../narrative.ts';
import {
  bodyStyles,
  DEFAULT_OVERVIEW_STYLE,
  isOverviewStyle,
  OVERVIEW_STYLE_TEXT,
  overviewStyleSection,
} from './overview-styles.ts';

/** What every style section holds, whichever form it takes. */
function expectUnchanged(section: string) {
  expect(section).toContain(
    'the overview’s "lede" and every chapter’s "headline" are each one sentence of at most 20 words',
  );
  expect(section).toContain('every chapter has a headline');
  expect(section).toContain('the rest of the JSON shape does not change');
  expect(section).toContain('does not support');
}

describe('overview styles', () => {
  it('give every style but the default its own text, and only the styles it names', () => {
    expect(Object.keys(OVERVIEW_STYLE_TEXT).toSorted()).toEqual([...OVERVIEW_STYLES].toSorted());
    expect(OVERVIEW_STYLE_TEXT[DEFAULT_OVERVIEW_STYLE]).toBeNull();
    const styled = OVERVIEW_STYLES.filter((style) => style !== DEFAULT_OVERVIEW_STYLE);
    expect(styled).toHaveLength(OVERVIEW_STYLES.length - 1);
    expect(
      styled.filter((style) => (OVERVIEW_STYLE_TEXT[style]?.trim().length ?? 0) < 100),
    ).toEqual([]);
  });

  it('write a section for one chosen style that keeps the lede, the headlines and the JSON as they are', () => {
    for (const style of OVERVIEW_STYLES.filter((name) => name !== DEFAULT_OVERVIEW_STYLE)) {
      const section = overviewStyleSection([style])!;
      expect(section).toMatch(new RegExp(`^## Overview Style: ${style}\n`));
      expectUnchanged(section);
      expect(section.endsWith(OVERVIEW_STYLE_TEXT[style]!)).toBe(true);
    }
    for (const style of OVERVIEW_STYLES.filter((name) => !['narrative', 'tldr'].includes(name))) {
      expect(overviewStyleSection([style])).toContain(
        `under the key "${style}" in "bodies", in place of "narrative"`,
      );
    }
    expect(overviewStyleSection(['narrative'])).toBeNull();
  });

  it('ask a tldr review for no body at all, leaving the lede and the headlines the whole of it', () => {
    expect(OVERVIEW_STYLE_TEXT.tldr).toContain('Leave out "bodies" entirely');
    expect(OVERVIEW_STYLE_TEXT.tldr).toContain(
      'each chapter’s headline are the whole of the prose',
    );
    expect(overviewStyleSection(['tldr'])).not.toContain('under the key');
  });

  it('ask for a body per style under its own key when several are chosen, each with its own text', () => {
    const section = overviewStyleSection(['narrative', 'simple', 'pros-cons'])!;
    expect(section).toMatch(/^## Overview Styles: narrative, simple, pros-cons\n/);
    expect(section).toContain('under its own key in "bodies": "narrative", "simple", "pros-cons"');
    expectUnchanged(section);
    expect(section).toContain('### narrative\nWhat your system prompt says a body holds.');
    expect(section).toContain(`### simple\n${OVERVIEW_STYLE_TEXT.simple!}`);
    expect(section.endsWith(`### pros-cons\n${OVERVIEW_STYLE_TEXT['pros-cons']!}`)).toBe(true);
  });

  it('ask nothing for tldr beside other styles, since the reader shows it by hiding the bodies', () => {
    expect(overviewStyleSection(['narrative', 'tldr'])).toBeNull();
    const one = overviewStyleSection(['tldr', 'plain'])!;
    expect(one).toMatch(/^## Overview Style: plain\n/);
    expect(one).not.toContain('tldr');
    expect(overviewStyleSection(['plain', 'simple', 'tldr'])).not.toContain('tldr');
    expect(bodyStyles(['tldr', 'plain', 'simple'])).toEqual(['plain', 'simple']);
  });

  it('know a style by its name and nothing else', () => {
    expect(isOverviewStyle('five-whys')).toBe(true);
    expect(isOverviewStyle('pros-cons')).toBe(true);
    expect(isOverviewStyle('Five-Whys')).toBe(false);
    expect(isOverviewStyle('checklist')).toBe(false);
    expect(isOverviewStyle('all')).toBe(false);
    expect(isOverviewStyle('toString')).toBe(false);
  });
});
