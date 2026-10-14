import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERVIEW_STYLE,
  isOverviewStyle,
  OVERVIEW_STYLE_TEXT,
  OVERVIEW_STYLES,
  overviewStyleSection,
} from './overview-styles.ts';

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

  it('write a section for a chosen style that keeps the lede and the JSON as they are', () => {
    for (const style of OVERVIEW_STYLES.filter((name) => name !== DEFAULT_OVERVIEW_STYLE)) {
      const section = overviewStyleSection(style)!;
      expect(section).toMatch(new RegExp(`^## Overview Style: ${style}\n`));
      expect(section).toContain('each "lede" is one sentence of at most 20 words');
      expect(section).toContain('the JSON shape does not change');
      expect(section).toContain('does not support');
      expect(section.endsWith(OVERVIEW_STYLE_TEXT[style]!)).toBe(true);
    }
    expect(overviewStyleSection('narrative')).toBeNull();
  });

  it('ask a tldr review for no body at all, leaving the lede the whole of it', () => {
    expect(OVERVIEW_STYLE_TEXT.tldr).toContain('Leave out the "body" entirely');
    expect(OVERVIEW_STYLE_TEXT.tldr).toContain('each lede is the whole of the prose');
  });

  it('know a style by its name and nothing else', () => {
    expect(isOverviewStyle('five-whys')).toBe(true);
    expect(isOverviewStyle('Five-Whys')).toBe(false);
    expect(isOverviewStyle('toString')).toBe(false);
  });
});
