import { describe, expect, it } from 'vitest';
import { citedChunk, fileCoverage, reviewCoverage, withFileHunks } from './coverage.ts';
import type {
  NarrativeChapter,
  NarrativeReview,
  ResolvedDiffHunk,
  ReviewFile,
} from './narrative.ts';
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
    overviewSummary: { lede: 'It changes things.' },
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
  it('counts hunks, not files, and keeps each file’s leftovers under its name', () => {
    const coverage = reviewCoverage(
      review({ 'src/a.ts': ['H0001', 'H0003'], 'src/b.ts': ['H0004'] }),
    );
    expect(coverage.total).toBe(5);
    expect(coverage.cited).toBe(3);
    expect(
      [...coverage.byFile.values()]
        .filter((file) => file.chunk !== null)
        .map((file) => [file.file.filename, file.cited, file.total]),
    ).toEqual([
      ['docs/c.md', 0, 1],
      ['src/a.ts', 2, 3],
    ]);
    // A file with nothing to cite still has an entry; one with no catalog has none.
    expect(coverage.byFile.get('src/mode-only.sh')).toMatchObject({ cited: 0, total: 0 });
    expect(coverage.byFile.has('yarn.lock')).toBe(false);
  });

  it('turns a file’s uncited hunks into one chunk, with a detected language', () => {
    const coverage = reviewCoverage(review({ 'src/a.ts': ['H0002'] }));
    expect(
      [...coverage.byFile.values()]
        .map(({ chunk }) => chunk)
        .filter((chunk) => chunk !== null)
        .map((chunk) => [chunk.filename, chunk.language, chunk.hunks.map((hunk) => hunk.id)]),
    ).toEqual([
      ['docs/c.md', 'markdown', ['H0005']],
      ['src/a.ts', 'typescript', ['H0001', 'H0003']],
      ['src/b.ts', 'typescript', ['H0004']],
    ]);
  });

  it('leaves no file with leftovers when every hunk is cited', () => {
    const coverage = reviewCoverage(
      review({
        'src/a.ts': ['H0001', 'H0002', 'H0003'],
        'src/b.ts': ['H0004'],
        'docs/c.md': ['H0005'],
      }),
    );
    expect(coverage).toMatchObject({ total: 5, cited: 5 });
    expect([...coverage.byFile.values()].every((file) => file.chunk === null)).toBe(true);
  });

  it('reports nothing for a review whose files carry no catalog', () => {
    // No list of hunks to have cited, so silence — not "everything is uncited".
    const coverage = reviewCoverage({ ...review({}), files: FILES });
    expect(coverage).toMatchObject({ total: 0, cited: 0 });
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

function chapter(
  id: string,
  hunks: ResolvedDiffHunk[],
  { filename = 'src/a.ts', language = 'typescript' } = {},
): NarrativeChapter {
  return { id, title: id, insights: [], diffChunks: [{ filename, language, hunks }] };
}

describe('citedChunk', () => {
  it('merges the chapters’ hunks into one chunk, ordered by the file rather than the narrative', () => {
    const chunk = citedChunk('src/a.ts', [
      chapter('ch1', [resolved('H0001', 1), resolved('H0003', 3)]),
      chapter('ch2', [resolved('H0002', 2)]),
    ]);
    // Chapter order would give H0001, H0003, H0002 — and slice H0002's
    // context out of a second copy of the file.
    expect(chunk?.hunks.map((hunk) => hunk.id)).toEqual(['H0001', 'H0002', 'H0003']);
  });

  it('carries a hunk two chapters both cite once', () => {
    const chunk = citedChunk('src/a.ts', [
      chapter('ch1', [resolved('H0001', 1), resolved('H0002', 2)]),
      chapter('ch2', [resolved('H0002', 2)]),
    ]);
    expect(chunk?.hunks.map((hunk) => hunk.id)).toEqual(['H0001', 'H0002']);
  });

  it('ignores chapters citing other files', () => {
    const chunk = citedChunk('src/a.ts', [
      chapter('ch1', [resolved('H0004', 1)], { filename: 'src/b.ts' }),
      chapter('ch2', [resolved('H0001', 1)]),
    ]);
    expect(chunk).toEqual({
      filename: 'src/a.ts',
      language: 'typescript',
      hunks: [resolved('H0001', 1)],
    });
  });

  it('is null when no chapter names the file at all', () => {
    expect(citedChunk('src/a.ts', [chapter('ch1', [], { filename: 'src/b.ts' })])).toBeNull();
    expect(citedChunk('src/a.ts', [])).toBeNull();
  });

  it('keeps a chapter that names the file and cites nothing, which reads as the whole file', () => {
    // An empty hunk list is what the inline diff falls back on to show the
    // file entire; returning null here would drop the diff instead.
    expect(citedChunk('src/a.ts', [chapter('ch1', [])])?.hunks).toEqual([]);
  });

  it('takes the language from the first citing chapter', () => {
    const chunk = citedChunk('src/a.ts', [
      chapter('ch1', [resolved('H0001', 1)], { language: 'tsx' }),
      chapter('ch2', [resolved('H0002', 2)], { language: 'typescript' }),
    ]);
    expect(chunk?.language).toBe('tsx');
  });
});
