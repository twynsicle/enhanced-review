import { describe, expect, it } from 'vitest';
import { debugMarks, hunkMarks, moveTags } from './hunk-marks';
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

describe('moveTags', () => {
  it('says a move is unchanged or edited, and keeps the percentage for the hover', () => {
    expect(moveTags([makeHunk(1, moved(100))])).toEqual([
      expect.objectContaining({
        label: 'Moved unchanged from src/old.ts',
        filename: 'src/old.ts',
        detail: 'Every line was removed from src/old.ts as it is here',
        tone: 'move',
        lines: 'L11-20',
      }),
    ]);
    expect(
      moveTags([makeHunk(1, { movedTo: { filename: 'src/new.ts', similarity: 85 } })]),
    ).toEqual([
      expect.objectContaining({
        label: 'Moved to src/new.ts, with edits',
        filename: 'src/new.ts',
        detail: '85% of these lines match the lines added to src/new.ts',
        tone: 'move',
        lines: 'L11-20',
      }),
    ]);
  });

  it('gives one tag per move, its touching parts joined into one range, and none for other facts', () => {
    const tags = moveTags([
      makeHunk(3, moved(90)),
      makeHunk(1, moved(90)),
      makeHunk(2, moved(90)),
      makeHunk(5, { whitespaceOnly: true }),
      makeHunk(7, { importsOnly: true }),
    ]);
    expect(tags.map((tag) => `${tag.label} · ${tag.lines}`)).toEqual([
      'Moved from src/old.ts, with edits · L11-40',
    ]);
  });

  it('gives each part its own strength in the hover when the parts of one tag differ', () => {
    const [tag] = moveTags([makeHunk(1, moved(92)), makeHunk(4, moved(61))]);
    expect(tag?.detail.split('\n')).toEqual([
      'L11-20: 92% of these lines match the lines removed from src/old.ts',
      'L41-50: 61% of these lines match the lines removed from src/old.ts',
    ]);
  });
});

describe('hunkMarks', () => {
  it('labels skim hunks and proven facts, fades moves less, and leaves a plain read hunk alone', () => {
    const marks = hunkMarks([
      makeHunk(1),
      makeHunk(2, { tier: 'skim', skimReason: 'test fixtures' }),
      makeHunk(3, { tier: 'skim' }),
      makeHunk(4, moved(100)),
      makeHunk(5, { tier: 'skim', ...moved(100), skimReason: 'helper renamed' }),
    ]);
    expect(
      marks.map((mark) => [mark.label, mark.fade, mark.tone, mark.hunks.map((h) => h.id)]),
    ).toEqual([
      ['Skim · test fixtures', 'skim', 'plain', ['H0002']],
      ['Skim', 'skim', 'plain', ['H0003']],
      ['Moved unchanged from src/old.ts', 'move', 'move', ['H0004']],
      ['Skim · Moved unchanged from src/old.ts · helper renamed', 'skim', 'move', ['H0005']],
    ]);
  });

  it('keeps a moved path apart in the label, so it can give way from its start', () => {
    const [mark] = hunkMarks([makeHunk(1, { tier: 'skim', ...moved(80), skimReason: 'helper' })]);
    expect(mark?.parts).toEqual([
      { text: 'Skim' },
      { text: ' · ' },
      { text: 'Moved from ' },
      { text: 'src/old.ts', path: true },
      { text: ', with edits' },
      { text: ' · ' },
      { text: 'helper' },
    ]);
    expect(mark?.label).toBe('Skim · Moved from src/old.ts, with edits · helper');
  });

  it('drops a skim reason that only repeats the proven fact', () => {
    const marks = hunkMarks([
      makeHunk(1, { tier: 'skim', importsOnly: true, skimReason: 'imports only' }),
      makeHunk(3, { tier: 'skim', whitespaceOnly: true, skimReason: ' Whitespace only . ' }),
      makeHunk(5, { tier: 'skim', importsOnly: true, skimReason: 'barrel re-exports' }),
    ]);
    expect(marks.map((mark) => [mark.label, mark.detail])).toEqual([
      ['Skim · Imports only', 'Every line changed here is part of an import or re-export'],
      [
        'Skim · Whitespace only',
        'Only whitespace changed, and none of it where it could change how the code parses',
      ],
      [
        'Skim · Imports only · barrel re-exports',
        'Every line changed here is part of an import or re-export. barrel re-exports',
      ],
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

describe('debugMarks', () => {
  it('labels every hunk on its own with its id, tier and split part, joining nothing', () => {
    const fixtures = { tier: 'skim', skimReason: 'test fixtures' } as const;
    const marks = debugMarks([
      makeHunk(1, { ...fixtures, part: { part: 1, of: 2 } }),
      makeHunk(2, { ...fixtures, part: { part: 2, of: 2 } }),
      makeHunk(3),
      makeHunk(4, moved(100)),
    ]);
    expect(marks.map((mark) => [mark.label, mark.fade])).toEqual([
      ['H0001 · skim · part 1/2 · test fixtures', 'skim'],
      ['H0002 · skim · part 2/2 · test fixtures', 'skim'],
      ['H0003 · read', 'none'],
      ['H0004 · read · Moved unchanged from src/old.ts', 'move'],
    ]);
  });
});
