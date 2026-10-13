import { beforeEach, describe, expect, it } from 'vitest';
import { SKIM_MARKS_KEY, useSkimMarks } from './skim-marks';

function marksAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(SKIM_MARKS_KEY);
  else window.localStorage.setItem(SKIM_MARKS_KEY, stored);
  void useSkimMarks.persist.rehydrate();
  return useSkimMarks.getState().marks;
}

describe('skim marks', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSkimMarks.setState({ marks: 'plain' });
  });

  it('draws skim hunks plainly when nothing is stored', () => {
    expect(marksAfterRehydrate(null)).toBe('plain');
  });

  it('keeps a reader who asked for the marks', () => {
    expect(marksAfterRehydrate('marked')).toBe('marked');
  });

  it('ignores a value it does not recognise', () => {
    expect(marksAfterRehydrate('folded')).toBe('plain');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useSkimMarks.getState().toggle();
    expect(window.localStorage.getItem(SKIM_MARKS_KEY)).toBe('marked');
    useSkimMarks.getState().toggle();
    expect(window.localStorage.getItem(SKIM_MARKS_KEY)).toBe('plain');
  });
});
