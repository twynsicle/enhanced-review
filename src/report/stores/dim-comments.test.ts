import { beforeEach, describe, expect, it } from 'vitest';
import { DIM_COMMENTS_KEY, useDimComments } from './dim-comments';

function commentsAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(DIM_COMMENTS_KEY);
  else window.localStorage.setItem(DIM_COMMENTS_KEY, stored);
  void useDimComments.persist.rehydrate();
  return useDimComments.getState().comments;
}

describe('dim comments', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDimComments.setState({ comments: 'normal' });
  });

  it('paints comments normally when nothing is stored', () => {
    expect(commentsAfterRehydrate(null)).toBe('normal');
  });

  it('keeps a reader who dimmed them dimmed', () => {
    expect(commentsAfterRehydrate('dimmed')).toBe('dimmed');
  });

  it('ignores a value it does not recognise', () => {
    expect(commentsAfterRehydrate('hidden')).toBe('normal');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useDimComments.getState().toggle();
    expect(window.localStorage.getItem(DIM_COMMENTS_KEY)).toBe('dimmed');
    useDimComments.getState().toggle();
    expect(window.localStorage.getItem(DIM_COMMENTS_KEY)).toBe('normal');
  });
});
