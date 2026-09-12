import { describe, expect, it } from 'vitest';
import {
  buildInlineDiffSnippets,
  formatSelectedHunkLabel,
  groupSelectedHunks,
} from './inline-diff-snippets.ts';
import type { ResolvedDiffHunk } from './narrative.ts';

function makeHunk(overrides: Partial<ResolvedDiffHunk>): ResolvedDiffHunk {
  return {
    id: 'H0001',
    fileOrder: 1,
    original: { startLine: 1, lineCount: 1 },
    modified: { startLine: 1, lineCount: 1 },
    ...overrides,
  };
}

function makeLines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`).join('\n');
}

/** The lines `makeLines` would number `from` through `to`, inclusive. */
function takeLines(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => `${prefix}${String(from + index)}`);
}

describe('groupSelectedHunks', () => {
  it('groups consecutive selected hunks together', () => {
    const groups = groupSelectedHunks([
      makeHunk({ id: 'H0002', fileOrder: 2 }),
      makeHunk({ id: 'H0001', fileOrder: 1 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((hunk) => hunk.id)).toEqual(['H0001', 'H0002']);
  });

  it('splits selected hunks when an unselected hunk exists between them', () => {
    const groups = groupSelectedHunks([
      makeHunk({ id: 'H0001', fileOrder: 1 }),
      makeHunk({ id: 'H0003', fileOrder: 3 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('returns no groups for no hunks', () => {
    expect(groupSelectedHunks([])).toEqual([]);
  });
});

describe('buildInlineDiffSnippets', () => {
  it('builds one snippet for consecutive hunks and expands with context', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          id: 'H0001',
          fileOrder: 1,
          original: { startLine: 10, lineCount: 1 },
          modified: { startLine: 10, lineCount: 1 },
        }),
        makeHunk({
          id: 'H0002',
          fileOrder: 2,
          original: { startLine: 14, lineCount: 1 },
          modified: { startLine: 14, lineCount: 1 },
        }),
      ],
      original: makeLines('o', 30),
      modified: makeLines('m', 30),
      contextLines: 2,
    });

    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toMatchObject({
      key: 'group-1-2',
      originalStartLine: 8,
      modifiedStartLine: 8,
    });
  });

  it('splits snippets when file-order gaps imply unselected hunks', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          id: 'H0001',
          fileOrder: 1,
          original: { startLine: 5, lineCount: 1 },
          modified: { startLine: 5, lineCount: 1 },
        }),
        makeHunk({
          id: 'H0003',
          fileOrder: 3,
          original: { startLine: 15, lineCount: 1 },
          modified: { startLine: 15, lineCount: 1 },
        }),
      ],
      original: makeLines('o', 25),
      modified: makeLines('m', 25),
      contextLines: 1,
    });

    expect(snippets).toHaveLength(2);
    expect(snippets.map((snippet) => snippet.key)).toEqual(['group-1-1', 'group-3-3']);
  });

  it('supports pure insertion and pure deletion groups when one side is empty', () => {
    const inserted = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          original: { startLine: 1, lineCount: 0 },
          modified: { startLine: 1, lineCount: 3 },
        }),
      ],
      original: '',
      modified: makeLines('m', 4),
      contextLines: 1,
    });
    const deleted = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          original: { startLine: 2, lineCount: 3 },
          modified: { startLine: 2, lineCount: 0 },
        }),
      ],
      original: makeLines('o', 5),
      modified: '',
      contextLines: 1,
    });

    expect(inserted[0]).toMatchObject({
      original: '',
      modified: 'm1\nm2\nm3\nm4',
      originalStartLine: 1,
      modifiedStartLine: 1,
    });
    expect(deleted[0]).toMatchObject({
      original: 'o1\no2\no3\no4\no5',
      modified: '',
      originalStartLine: 1,
      modifiedStartLine: 1,
    });
  });

  it('opens both sides on the same line when the group starts with an insertion', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          original: { startLine: 7, lineCount: 0 },
          modified: { startLine: 8, lineCount: 2 },
        }),
      ],
      original: makeLines('o', 20),
      modified: [...takeLines('o', 1, 7), 'n1', 'n2', ...takeLines('o', 8, 20)].join('\n'),
      contextLines: 3,
    });

    expect(snippets[0]).toMatchObject({
      originalStartLine: 5,
      modifiedStartLine: 5,
      original: 'o5\no6\no7\no8\no9\no10',
      modified: 'o5\no6\no7\nn1\nn2\no8\no9\no10',
    });
  });

  it('opens both sides on the same line when the group starts with a deletion', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          original: { startLine: 12, lineCount: 3 },
          modified: { startLine: 11, lineCount: 0 },
        }),
      ],
      original: makeLines('o', 20),
      modified: [...takeLines('o', 1, 11), ...takeLines('o', 15, 20)].join('\n'),
      contextLines: 3,
    });

    expect(snippets[0]).toMatchObject({
      originalStartLine: 9,
      modifiedStartLine: 9,
      original: 'o9\no10\no11\no12\no13\no14\no15\no16\no17',
      modified: 'o9\no10\no11\no15\no16\no17',
    });
  });

  it('anchors the group end on the last hunk when the first is an insertion', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          id: 'H0001',
          fileOrder: 1,
          original: { startLine: 7, lineCount: 0 },
          modified: { startLine: 8, lineCount: 2 },
        }),
        makeHunk({
          id: 'H0002',
          fileOrder: 2,
          original: { startLine: 12, lineCount: 2 },
          modified: { startLine: 14, lineCount: 2 },
        }),
      ],
      original: makeLines('o', 30),
      modified: [
        ...takeLines('o', 1, 7),
        'n1',
        'n2',
        ...takeLines('o', 8, 11),
        'r1',
        'r2',
        ...takeLines('o', 14, 30),
      ].join('\n'),
      contextLines: 2,
    });

    expect(snippets[0]).toMatchObject({
      originalStartLine: 6,
      modifiedStartLine: 6,
      original: 'o6\no7\no8\no9\no10\no11\no12\no13\no14\no15',
      modified: 'o6\no7\nn1\nn2\no8\no9\no10\no11\nr1\nr2\no14\no15',
    });
  });

  it('does not push the group end forward when the last hunk is an insertion', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          id: 'H0001',
          fileOrder: 1,
          original: { startLine: 5, lineCount: 2 },
          modified: { startLine: 5, lineCount: 2 },
        }),
        makeHunk({
          id: 'H0002',
          fileOrder: 2,
          original: { startLine: 12, lineCount: 0 },
          modified: { startLine: 13, lineCount: 2 },
        }),
      ],
      original: makeLines('o', 30),
      modified: [
        ...takeLines('o', 1, 4),
        'r1',
        'r2',
        ...takeLines('o', 7, 12),
        'n1',
        'n2',
        ...takeLines('o', 13, 30),
      ].join('\n'),
      contextLines: 2,
    });

    expect(snippets[0]).toMatchObject({
      originalStartLine: 3,
      modifiedStartLine: 3,
      original: 'o3\no4\no5\no6\no7\no8\no9\no10\no11\no12\no13\no14',
      modified: 'o3\no4\nr1\nr2\no7\no8\no9\no10\no11\no12\nn1\nn2\no13\no14',
    });
  });

  // An insertion above line 1 is `@@ -0,0 +1,n @@`, and the hunk catalog has no
  // line 0 to hand on, so the original side arrives here starting at 1.
  it('holds an insertion at the top of the file on the first line', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          original: { startLine: 1, lineCount: 0 },
          modified: { startLine: 1, lineCount: 3 },
        }),
      ],
      original: makeLines('o', 4),
      modified: ['n1', 'n2', 'n3', ...takeLines('o', 1, 4)].join('\n'),
      contextLines: 5,
    });

    expect(snippets[0]).toMatchObject({
      originalStartLine: 1,
      modifiedStartLine: 1,
      original: 'o1\no2\no3\no4',
      modified: 'n1\nn2\nn3\no1\no2\no3\no4',
    });
  });

  it('keeps original and modified offsets independent when line numbers diverge', () => {
    const snippets = buildInlineDiffSnippets({
      hunks: [
        makeHunk({
          original: { startLine: 10, lineCount: 3 },
          modified: { startLine: 13, lineCount: 5 },
        }),
      ],
      original: makeLines('o', 20),
      modified: makeLines('m', 24),
      contextLines: 2,
    });

    expect(snippets[0]).toMatchObject({
      originalStartLine: 8,
      modifiedStartLine: 11,
      original: 'o8\no9\no10\no11\no12\no13\no14',
      modified: 'm11\nm12\nm13\nm14\nm15\nm16\nm17\nm18\nm19',
    });
  });

  it('drops a group when both files are empty', () => {
    expect(buildInlineDiffSnippets({ hunks: [makeHunk({})], original: '', modified: '' })).toEqual(
      [],
    );
  });
});

describe('formatSelectedHunkLabel', () => {
  it('uses modified ranges and falls back to original ranges for pure deletions', () => {
    const label = formatSelectedHunkLabel([
      makeHunk({
        id: 'H0002',
        fileOrder: 2,
        original: { startLine: 20, lineCount: 2 },
        modified: { startLine: 30, lineCount: 0 },
      }),
      makeHunk({
        id: 'H0001',
        fileOrder: 1,
        original: { startLine: 5, lineCount: 1 },
        modified: { startLine: 8, lineCount: 3 },
      }),
    ]);
    expect(label).toBe('L8-10, orig L20-21');
  });

  it('uses single-line forms for one-line spans', () => {
    const label = formatSelectedHunkLabel([
      makeHunk({
        fileOrder: 1,
        original: { startLine: 4, lineCount: 1 },
        modified: { startLine: 4, lineCount: 0 },
      }),
      makeHunk({
        fileOrder: 2,
        original: { startLine: 9, lineCount: 1 },
        modified: { startLine: 9, lineCount: 1 },
      }),
    ]);
    expect(label).toBe('orig L4, L9');
  });
});
