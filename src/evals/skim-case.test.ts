import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caseFiles,
  catalogDigest,
  formatLabels,
  listCases,
  parseLabels,
  readCase,
  writeCase,
  type Label,
  type LoadedCase,
} from './skim-case.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'er-skims-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const labels: Label[] = [
  { id: 'H0001', file: 'src/a.ts', header: '@@ -1 +1 @@', tier: 'read', category: 'logic' },
  { id: 'H0002', file: 'src/a.ts', header: '@@ -5 +5 @@', tier: 'skim', note: 'docs' },
];

const loaded: LoadedCase = {
  case: {
    name: 'c',
    source: { folder: 'er-reviews/pr-1/x', repo: 'o/r', kind: 'pr' },
    title: 't',
    description: null,
    commits: [],
    files: [{ filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 0 }],
    hunks: labels.map((label, index) => ({
      id: label.id,
      filename: label.file,
      header: label.header,
      fileOrder: index + 1,
      original: { startLine: 1, lineCount: 1 },
      modified: { startLine: 1, lineCount: 1 },
      changedLines: 1,
    })),
  },
  diff: 'diff --git a/src/a.ts b/src/a.ts\n',
  labels,
};

describe('labels.jsonl', () => {
  it('is one label per line, and reads back what it wrote', () => {
    const text = formatLabels(labels);
    expect(text.split('\n')).toHaveLength(3);
    expect(parseLabels(`${text}\n\n`)).toEqual(labels);
  });

  it('names the line that is not a label', () => {
    expect(() => parseLabels('{"id":"H0001"}\nnot json\n', 'x.jsonl')).toThrow('x.jsonl:1');
    expect(() =>
      parseLabels('{"id":"H0001","file":"a","header":"h","tier":"read"}\nnot json\n'),
    ).toThrow('labels.jsonl:2 is not JSON');
    expect(() => parseLabels('{"id":"H0001","file":"a","header":"h","tier":"maybe"}\n')).toThrow(
      'is not a label',
    );
  });
});

describe('a case folder', () => {
  it('round-trips, and lists by name', async () => {
    await writeCase(caseFiles(root, 'c'), loaded);
    await writeCase(caseFiles(root, 'b'), loaded);
    expect(await listCases(root)).toEqual(['b', 'c']);
    expect(await readCase(caseFiles(root, 'c'))).toEqual(loaded);
    expect(await listCases(path.join(root, 'nowhere'))).toEqual([]);
  });

  it('refuses labels that do not match the hunks, once each', async () => {
    const files = caseFiles(root, 'c');
    await writeCase(files, {
      ...loaded,
      labels: [labels[0]!, labels[0]!, { ...labels[1]!, id: 'H0009' }],
    });
    await expect(readCase(files)).rejects.toThrow(
      "H0001 is labelled twice; H0009 is not in the case's hunks; H0002 has no label",
    );
  });
});

describe('catalogDigest', () => {
  it('is stable for one catalog and changes when a hunk is renumbered or recut', () => {
    const digest = catalogDigest(loaded.case);
    expect(catalogDigest(structuredClone(loaded.case))).toBe(digest);
    const recut = structuredClone(loaded.case);
    recut.hunks[1]!.header = '@@ -5 +5 @@ (part 1 of 2)';
    expect(catalogDigest(recut)).not.toBe(digest);
  });
});
