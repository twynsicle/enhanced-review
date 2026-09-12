import { describe, expect, it } from 'vitest';
import { describeCoverageGap, fileCoverage, reviewCoverage, withFileHunks } from './coverage.ts';
import type { NarrativeReview, ResolvedDiffHunk, ReviewFile } from './narrative.ts';
import type { DiffHunk } from './prompt/diff-hunk-catalog.ts';

const span = (startLine: number, lineCount: number) => ({ startLine, lineCount });

function catalog(id: string, filename: string, fileOrder: number): DiffHunk {
  return {
    id,
    filename,
    header: `@@ -${String(fileOrder * 10)},1 +${String(fileOrder * 10)},2 @@`,
    fileOrder,
    original: span(fileOrder * 10, 1),
    modified: span(fileOrder * 10, 2),
  };
}

function resolved(id: string, fileOrder: number): ResolvedDiffHunk {
  return { id, fileOrder, original: span(fileOrder * 10, 1), modified: span(fileOrder * 10, 2) };
}

const HUNKS: DiffHunk[] = [
  catalog('H0001', 'src/a.ts', 1),
  catalog('H0002', 'src/a.ts', 2),
  catalog('H0003', 'src/a.ts', 3),
  catalog('H0004', 'src/b.ts', 1),
  catalog('H0005', 'docs/c.md', 1),
];

const FILES: ReviewFile[] = [
  { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 },
  { filename: 'src/b.ts', status: 'added', additions: 2, deletions: 0 },
  { filename: 'docs/c.md', status: 'modified', additions: 1, deletions: 0 },
  { filename: 'src/mode-only.sh', status: 'modified', additions: 0, deletions: 0 },
  { filename: 'yarn.lock', status: 'modified', additions: 9, deletions: 9, skipped: 'built-in' },
];

/** A review citing the given hunk ids per file, over the catalogued files. */
function review(cites: Record<string, string[]>): NarrativeReview {
  return {
    prTitle: 'A change',
    overviewSummary: 'It changes things.',
    files: withFileHunks(FILES, HUNKS),
    chapters: [
      {
        id: 'ch1',
        title: 'One',
        insights: [],
        diffChunks: Object.entries(cites).map(([filename, ids]) => ({
          filename,
          language: 'typescript',
          hunks: ids.map((id) => resolved(id, Number(id.slice(-1)))),
        })),
      },
    ],
  };
}

describe('withFileHunks', () => {
  it('gives each reviewed file its catalog, an empty one when it has no hunks, and a skipped file none', () => {
    const files = withFileHunks(FILES, HUNKS);
    expect(files.map((file) => file.hunks?.map((hunk) => hunk.id))).toEqual([
      ['H0001', 'H0002', 'H0003'],
      ['H0004'],
      ['H0005'],
      [],
      undefined,
    ]);
    // The catalog's filename and header stay behind: the file already says which it is.
    expect(files[0]?.hunks?.[0]).toEqual(resolved('H0001', 1));
  });
});

describe('reviewCoverage', () => {
  it('counts hunks, not files, and lists every file with leftovers by name', () => {
    const coverage = reviewCoverage(
      review({ 'src/a.ts': ['H0001', 'H0003'], 'src/b.ts': ['H0004'] }),
    );
    expect(coverage.total).toBe(5);
    expect(coverage.cited).toBe(3);
    expect(coverage.uncited.map((c) => [c.file.filename, c.cited, c.total])).toEqual([
      ['docs/c.md', 0, 1],
      ['src/a.ts', 2, 3],
    ]);
    // A file with nothing to cite is not listed: there was nothing to leave out.
    expect(coverage.byFile.get('src/mode-only.sh')).toMatchObject({ cited: 0, total: 0 });
    expect(coverage.byFile.has('yarn.lock')).toBe(false);
  });

  it('turns the uncited hunks into one chunk per file, by filename, with a detected language', () => {
    const coverage = reviewCoverage(review({ 'src/a.ts': ['H0002'] }));
    expect(
      coverage.uncited.map(({ chunk }) => [
        chunk.filename,
        chunk.language,
        chunk.hunks.map((hunk) => hunk.id),
      ]),
    ).toEqual([
      ['docs/c.md', 'markdown', ['H0005']],
      ['src/a.ts', 'typescript', ['H0001', 'H0003']],
      ['src/b.ts', 'typescript', ['H0004']],
    ]);
  });

  it('is empty when every hunk is cited', () => {
    const coverage = reviewCoverage(
      review({
        'src/a.ts': ['H0001', 'H0002', 'H0003'],
        'src/b.ts': ['H0004'],
        'docs/c.md': ['H0005'],
      }),
    );
    expect(coverage).toMatchObject({ total: 5, cited: 5, uncited: [] });
  });

  it('reports nothing for a review stored without a catalog', () => {
    // An older review's files carry no hunks: silence, not "everything is uncited".
    const coverage = reviewCoverage({ ...review({}), files: FILES });
    expect(coverage).toMatchObject({ total: 0, cited: 0, uncited: [] });
    expect(coverage.byFile.size).toBe(0);
    expect(fileCoverage(FILES[0]!, new Set())).toBeNull();
  });

  it('does not count a hunk a diagram grounds on but no chapter cites', () => {
    const base = review({});
    const withDiagram: NarrativeReview = {
      ...base,
      chapters: [
        {
          ...base.chapters[0]!,
          diagram: {
            id: 'map',
            title: 'Map',
            caption: 'Where it lands.',
            kind: 'architecture',
            direction: 'down',
            groups: [],
            nodes: [
              {
                id: 'a',
                label: 'a.ts',
                kind: 'code',
                change: 'modified',
                filename: 'src/a.ts',
                hunkIds: ['H0001'],
              },
              { id: 'b', label: 'b.ts', kind: 'code', change: 'added' },
            ],
            edges: [{ from: 'a', to: 'b', change: 'added' }],
          },
        },
      ],
    };
    expect(reviewCoverage(withDiagram).cited).toBe(0);
  });
});

describe('FileCoverage.chunk', () => {
  it('is null once a file is fully discussed', () => {
    const coverage = fileCoverage(withFileHunks(FILES, HUNKS)[1]!, new Set(['H0004']));
    expect(coverage?.chunk).toBeNull();
  });
});

describe('describeCoverageGap', () => {
  it('names both halves of the gap, or only the half there is', () => {
    expect(describeCoverageGap(reviewCoverage(review({ 'src/a.ts': ['H0001'] })))).toBe(
      '2 files not discussed in any chapter, and 1 file discussed only in part',
    );
    expect(
      describeCoverageGap(
        reviewCoverage(review({ 'src/a.ts': ['H0001', 'H0002', 'H0003'], 'docs/c.md': ['H0005'] })),
      ),
    ).toBe('1 file not discussed in any chapter');
    expect(
      describeCoverageGap(
        reviewCoverage(
          review({ 'src/a.ts': ['H0001'], 'src/b.ts': ['H0004'], 'docs/c.md': ['H0005'] }),
        ),
      ),
    ).toBe('1 file discussed only in part');
  });
});
