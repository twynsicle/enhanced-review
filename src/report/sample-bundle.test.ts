import { describe, expect, it } from 'vitest';
import { filePair, parseBundle } from '@/review/bundle';
import { reviewCoverage } from '@/review/coverage';
import { buildFileTree, type FileTreeNode } from '@/report/reader/file-tree';
import { SAMPLE_BUNDLE, SAMPLE_MISSING_FILE } from './sample-bundle';

const coverage = reviewCoverage(SAMPLE_BUNDLE.review);
/** Every chunk the reader draws: the chapters' own, and each file's leftovers. */
const chunks = [
  ...SAMPLE_BUNDLE.review.chapters.flatMap((chapter) => chapter.diffChunks),
  ...[...coverage.byFile.values()].map((file) => file.chunk).filter((chunk) => chunk !== null),
];

/**
 * A word found on the first line each hunk points at, and nowhere else near it.
 * The spans in `sample-bundle.ts` are hand-written positional numbers against
 * the file contents beside them, so editing a line in one of those contents
 * slides every span below it and nothing says so — the overrun check only
 * notices the ones that slide off the end of the file.
 */
const HUNK_ANCHORS: Record<string, string> = {
  H0001: "Cadence = 'hourly'",
  H0002: 'Paused schedules keep',
  H0003: 'const HOUR_MS',
  H0004: 'return INTERVALS[cadence]',
  H0005: 'if (schedule.paused)',
  H0006: 'import { isDue',
  H0007: 'Superseded by src/scheduler',
  H0008: '{',
  H0010: 'export { isDue, type Cadence',
  H0011: "import type { Clock } from '../clock'",
  H0012: "import type { Schedule } from '../cadence'",
};

describe('the sample report bundle', () => {
  it('parses as a current bundle', () => {
    const result = parseBundle(JSON.parse(JSON.stringify(SAMPLE_BUNDLE)));
    expect(result.ok ? 'ok' : result).toBe('ok');
  });

  it('embeds every chunk file except the one left out on purpose', () => {
    const missing = chunks
      .map((chunk) => chunk.filename)
      .filter((filename) => !(filename in SAMPLE_BUNDLE.files));
    expect(missing).toEqual([SAMPLE_MISSING_FILE]);
  });

  it('keeps every hunk inside the file it points at', () => {
    const overruns: string[] = [];
    for (const chunk of chunks) {
      const { base, head } = filePair(SAMPLE_BUNDLE, chunk.filename);
      for (const { id, original, modified } of chunk.hunks) {
        if (
          base.kind === 'content' &&
          original.startLine + original.lineCount - 1 > base.lineCount
        ) {
          overruns.push(`${id} original`);
        }
        if (
          head.kind === 'content' &&
          modified.startLine + modified.lineCount - 1 > head.lineCount
        ) {
          overruns.push(`${id} modified`);
        }
      }
    }
    expect(overruns).toEqual([]);
  });

  it('starts every hunk on the line it claims', () => {
    const anchored: string[] = [];
    const misplaced: string[] = [];
    for (const chunk of chunks) {
      const { base, head } = filePair(SAMPLE_BUNDLE, chunk.filename);
      for (const { id, original, modified } of chunk.hunks) {
        // The side that carries the change, falling back to the one that has
        // content at all: a removed file and a too-large head only have a base.
        const start =
          head.kind === 'content' && modified.lineCount > 0
            ? { content: head.content, line: modified.startLine }
            : base.kind === 'content' && original.lineCount > 0
              ? { content: base.content, line: original.startLine }
              : null;
        if (!start) continue;
        anchored.push(id);
        const line = start.content.split('\n')[start.line - 1] ?? '';
        if (!line.includes(HUNK_ANCHORS[id] ?? id)) misplaced.push(`${id} → ${line}`);
      }
    }
    expect(misplaced).toEqual([]);
    expect(anchored.toSorted()).toEqual(Object.keys(HUNK_ANCHORS).toSorted());
  });

  it('lists skipped files, which no chunk points at', () => {
    const skipped = (SAMPLE_BUNDLE.review.files ?? []).filter((file) => file.skipped);
    expect(skipped.length).toBeGreaterThan(0);
    const cited = new Set(chunks.map((chunk) => chunk.filename));
    expect(skipped.filter((file) => cited.has(file.filename))).toEqual([]);
  });

  it('leaves one file undiscussed and one discussed in part, so the file view draws both', () => {
    expect(
      [...coverage.byFile.values()]
        .filter((file) => file.chunk !== null)
        .map((file) => [file.file.filename, file.cited, file.total]),
    ).toEqual([
      ['src/scheduler/cadence.ts', 4, 5],
      ['src/scheduler/index.ts', 0, 1],
    ]);
  });

  it('puts a directory between two files of its parent, where the tree is hardest to read', () => {
    const files = (SAMPLE_BUNDLE.review.files ?? []).toSorted((a, b) =>
      a.filename.localeCompare(b.filename),
    );
    const find = (nodes: readonly FileTreeNode[], name: string) =>
      nodes.find((node) => node.kind === 'directory' && node.name === name);
    const src = find(buildFileTree(files), 'src');
    const scheduler = src?.kind === 'directory' ? find(src.children, 'scheduler') : undefined;
    expect(
      scheduler?.kind === 'directory' ? scheduler.children.map((node) => node.kind) : [],
    ).toEqual(['file', 'directory', 'file', 'file']);
  });

  it('covers every file-side state the reader draws', () => {
    const kinds = Object.values(SAMPLE_BUNDLE.files).flatMap((f) => [f.base.kind, f.head.kind]);
    expect(new Set(kinds)).toEqual(new Set(['content', 'absent', 'too-large']));
  });
});
