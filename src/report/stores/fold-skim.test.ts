import { beforeEach, describe, expect, it } from 'vitest';
import { FOLD_SKIM_KEY, useFoldSkim } from './fold-skim';

function skimAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(FOLD_SKIM_KEY);
  else window.localStorage.setItem(FOLD_SKIM_KEY, stored);
  void useFoldSkim.persist.rehydrate();
  return useFoldSkim.getState().skim;
}

describe('fold skim', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFoldSkim.setState({ skim: 'shown' });
  });

  it('shows skim hunks when nothing is stored', () => {
    expect(skimAfterRehydrate(null)).toBe('shown');
  });

  it('keeps a reader who folded them folded', () => {
    expect(skimAfterRehydrate('folded')).toBe('folded');
  });

  it('ignores a value it does not recognise', () => {
    expect(skimAfterRehydrate('hidden')).toBe('shown');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFoldSkim.getState().toggle();
    expect(window.localStorage.getItem(FOLD_SKIM_KEY)).toBe('folded');
    useFoldSkim.getState().toggle();
    expect(window.localStorage.getItem(FOLD_SKIM_KEY)).toBe('shown');
  });
});
