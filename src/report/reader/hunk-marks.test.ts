import { describe, expect, it } from 'vitest';
import { factTags, hunkMarks } from './hunk-marks';
import type { CitedHunk } from '@/review/narrative';

function makeHunk(fileOrder: number, overrides: Partial<CitedHunk> = {}): CitedHunk {
  const startLine = fileOrder * 10 + 1;
  return {
    id: `H000${String(fileOrder)}`,
    fileOrder,
    original: { startLine, lineCount: 10 },
    modified: { startLine, lineCount: 10 },
    changedLines: 10,
    tier: 'read',
    ...overrides,
  };
}

const moved = (similarity: number) => ({ movedFrom: { filename: 'src/old.ts', similarity } });

describe('factTags', () => {
  it('says a move is unchanged or edited, and keeps the percentage for the hover', () => {
    expect(factTags([makeHunk(1, moved(100))])).toEqual([
      {
        label: 'Moved unchanged from src/old.ts',
        detail: 'Every line was removed from src/old.ts as it is here',
        lines: 'L11-20',
      },
    ]);
    expect(
      factTags([makeHunk(1, { movedTo: { filename: 'src/new.ts', similarity: 85 } })]),
    ).toEqual([
      {
        label: 'Moved to src/new.ts, with edits',
        detail: '85% of these lines match the lines added to src/new.ts',
        lines: 'L11-20',
      },
    ]);
  });

  it('gives one tag per fact, its touching parts joined into one range', () => {
    const tags = factTags([
      makeHunk(3, moved(90)),
      makeHunk(1, moved(90)),
      makeHunk(2, moved(90)),
      makeHunk(5, { whitespaceOnly: true }),
    ]);
    expect(tags.map((tag) => `${tag.label} · ${tag.lines}`)).toEqual([
      'Moved from src/old.ts, with edits · L11-40',
      'Whitespace only · L51-60',
    ]);
  });

  it('gives each part its own strength in the hover when the parts of one tag differ', () => {
    const [tag] = factTags([makeHunk(1, moved(92)), makeHunk(4, moved(61))]);
    expect(tag?.detail.split('\n')).toEqual([
      'L11-20: 92% of these lines match the lines removed from src/old.ts',
      'L41-50: 61% of these lines match the lines removed from src/old.ts',
    ]);
  });
});

describe('hunkMarks', () => {
  it('labels skim hunks and proven facts, and leaves a plain read hunk alone', () => {
    const marks = hunkMarks([
      makeHunk(1),
      makeHunk(2, { tier: 'skim', skimReason: 'test fixtures' }),
      makeHunk(3, { tier: 'skim' }),
      makeHunk(4, moved(100)),
      makeHunk(5, { tier: 'skim', ...moved(100), skimReason: 'helper renamed' }),
    ]);
    expect(marks.map((mark) => [mark.label, mark.skim, mark.hunks.map((h) => h.id)])).toEqual([
      ['Skim · test fixtures', true, ['H0002']],
      ['Skim', true, ['H0003']],
      ['Moved unchanged from src/old.ts', false, ['H0004']],
      ['Skim · Moved unchanged from src/old.ts · helper renamed', true, ['H0005']],
    ]);
  });

  it('joins neighbours that say the same, and only neighbours', () => {
    const fixtures = { tier: 'skim', skimReason: 'test fixtures' } as const;
    const marks = hunkMarks([
      makeHunk(1, fixtures),
      makeHunk(2, fixtures),
      makeHunk(3),
      makeHunk(4, fixtures),
      makeHunk(6, fixtures),
    ]);
    expect(marks.map((mark) => mark.hunks.map((h) => h.id))).toEqual([
      ['H0001', 'H0002'],
      ['H0004'],
      ['H0006'],
    ]);
  });
});
