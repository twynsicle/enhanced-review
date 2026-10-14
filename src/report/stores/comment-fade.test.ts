import { beforeEach, describe, expect, it } from 'vitest';
import { followCommentFade, COMMENT_FADE_KEY, COMMENT_FADES, useCommentFade } from './comment-fade';

function commentFadeAfterRehydrate(stored: string | null): number {
  if (stored === null) window.localStorage.removeItem(COMMENT_FADE_KEY);
  else window.localStorage.setItem(COMMENT_FADE_KEY, stored);
  void useCommentFade.persist.rehydrate();
  followCommentFade()();
  return useCommentFade.getState().fade;
}

function paintedFade(): string {
  return document.documentElement.style.getPropertyValue('--review-comment-fade');
}

describe('comment fade', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCommentFade.setState({ fade: COMMENT_FADES.default });
  });

  it('fades by the default when nothing is stored, painted as a fraction', () => {
    expect(commentFadeAfterRehydrate(null)).toBe(COMMENT_FADES.default);
    expect(paintedFade()).toBe(String(COMMENT_FADES.default / 100));
  });

  it('gives a reader back the strength they chose', () => {
    expect(commentFadeAfterRehydrate('35')).toBe(35);
    expect(paintedFade()).toBe('0.35');
  });

  it('pulls a value from outside the range back to the nearest end', () => {
    expect(commentFadeAfterRehydrate('100')).toBe(COMMENT_FADES.max);
    expect(commentFadeAfterRehydrate('5')).toBe(COMMENT_FADES.min);
  });

  it('falls back to the default on anything that is not a fade', () => {
    expect(commentFadeAfterRehydrate('strong')).toBe(COMMENT_FADES.default);
    expect(commentFadeAfterRehydrate('')).toBe(COMMENT_FADES.default);
  });

  it('stores the raw number', () => {
    useCommentFade.getState().setFade(45);
    expect(window.localStorage.getItem(COMMENT_FADE_KEY)).toBe('45');
  });
});
