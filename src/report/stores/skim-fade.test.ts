import { beforeEach, describe, expect, it } from 'vitest';
import { followSkimFade, SKIM_FADE_KEY, SKIM_FADES, useSkimFade } from './skim-fade';

function fadeAfterRehydrate(stored: string | null): number {
  if (stored === null) window.localStorage.removeItem(SKIM_FADE_KEY);
  else window.localStorage.setItem(SKIM_FADE_KEY, stored);
  void useSkimFade.persist.rehydrate();
  followSkimFade()();
  return useSkimFade.getState().fade;
}

function paintedFade(): string {
  return document.documentElement.style.getPropertyValue('--review-skim-fade');
}

describe('skim fade', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSkimFade.setState({ fade: SKIM_FADES.default });
  });

  it('fades by the default when nothing is stored, painted as a fraction', () => {
    expect(fadeAfterRehydrate(null)).toBe(SKIM_FADES.default);
    expect(paintedFade()).toBe(String(SKIM_FADES.default / 100));
  });

  it('gives a reader back the strength they chose', () => {
    expect(fadeAfterRehydrate('35')).toBe(35);
    expect(paintedFade()).toBe('0.35');
  });

  it('pulls a value from outside the range back to the nearest end', () => {
    expect(fadeAfterRehydrate('100')).toBe(SKIM_FADES.max);
    expect(fadeAfterRehydrate('5')).toBe(SKIM_FADES.min);
  });

  it('falls back to the default on anything that is not a fade', () => {
    expect(fadeAfterRehydrate('strong')).toBe(SKIM_FADES.default);
    expect(fadeAfterRehydrate('')).toBe(SKIM_FADES.default);
  });

  it('stores the raw number', () => {
    useSkimFade.getState().setFade(45);
    expect(window.localStorage.getItem(SKIM_FADE_KEY)).toBe('45');
  });
});
