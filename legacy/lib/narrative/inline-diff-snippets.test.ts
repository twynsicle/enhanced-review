import { describe, expect, it } from 'vitest';
import type { ResolvedDiffHunk } from '@enhanced-review/review-types';
import {
  buildInlineDiffSnippets,
  formatSelectedHunkLabel,
  groupSelectedHunks,
} from './inline-diff-snippets';

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
});
