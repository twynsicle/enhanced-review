import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DIAGRAM_CONTRIVED_DIR,
  DiagramBranchSpecSchema,
  ExpectSchema,
  giveaways,
  listDiagramBranches,
  packhouseRepo,
  readDiagramSpec,
} from './diagram-case.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'er-diagram-case-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const expectation = {
  overview: { kinds: ['architecture'] },
  chapterDiagrams: { min: 0, max: 1, kinds: ['sequence'] },
  mustName: ['a failed capture goes to the retry queue'],
  mustReach: ['src/payments/gateway.ts'],
  question: 'Where does a failed capture go now?',
};

const spec = {
  branch: 'feat/retry',
  title: 'Retry a failed capture',
  description: 'As the engineer would write it.',
  commit: { subject: 'Retry a failed capture', body: '' },
  removed: [],
  expect: expectation,
};

describe('ExpectSchema', () => {
  it('accepts an overview of several kinds, or none', () => {
    expect(ExpectSchema.safeParse(expectation).success).toBe(true);
    expect(ExpectSchema.safeParse({ ...expectation, overview: null }).success).toBe(true);
    expect(
      ExpectSchema.safeParse({
        ...expectation,
        overview: { kinds: ['architecture', 'beforeAfter'] },
      }).success,
    ).toBe(true);
  });

  it('refuses a kind the diagram schema does not know', () => {
    expect(
      ExpectSchema.safeParse({ ...expectation, overview: { kinds: ['flowchart'] } }).success,
    ).toBe(false);
  });

  it('refuses a chapter range that runs backwards, or allows a diagram of no kind', () => {
    const range = (min: number, max: number, kinds: string[]) =>
      ExpectSchema.safeParse({ ...expectation, chapterDiagrams: { min, max, kinds } }).success;
    expect(range(2, 1, ['state'])).toBe(false);
    expect(range(0, 1, [])).toBe(false);
    expect(range(0, 0, [])).toBe(true);
  });
});

describe('readDiagramSpec', () => {
  it('reads the skim spec plus its expectation', async () => {
    const specDir = path.join(root, 'retry');
    write(path.join(specDir, 'branch.json'), JSON.stringify(spec));
    expect(await readDiagramSpec(specDir)).toEqual(DiagramBranchSpecSchema.parse(spec));
  });

  it('refuses a spec with no expectation, naming the file', async () => {
    const specDir = path.join(root, 'bare');
    const { expect: _, ...bare } = spec;
    write(path.join(specDir, 'branch.json'), JSON.stringify(bare));
    await expect(readDiagramSpec(specDir)).rejects.toThrow(/branch\.json is not a branch spec/);
  });
});

describe('listDiagramBranches', () => {
  it('lists every branch under the eval’s directory and never the base', async () => {
    for (const name of ['base', 'retry-queue', 'on-hold']) {
      mkdirSync(path.join(root, DIAGRAM_CONTRIVED_DIR, name), { recursive: true });
    }
    expect(await listDiagramBranches(root)).toEqual(['on-hold', 'retry-queue']);
  });
});

describe('packhouseRepo', () => {
  it('is the eval’s base under the root', () => {
    expect(packhouseRepo('r').base).toBe(path.join('r', DIAGRAM_CONTRIVED_DIR, 'base'));
  });
});

describe('giveaways', () => {
  it('names the field or file and the word that gives the branch away', async () => {
    const specDir = path.join(root, 'told');
    write(path.join(specDir, 'files', 'src', 'ok.ts'), 'export const ok = 1;\n');
    write(path.join(specDir, 'files', 'src', 'told.ts'), '// a Sample of the kind\n');
    write(path.join(specDir, 'files', 'README.md'), 'An ordinary service.\n');
    const told = DiagramBranchSpecSchema.parse({
      ...spec,
      description: 'Written for the eval.',
      commit: { subject: 'Retry', body: 'A fixture branch.' },
    });
    expect(await giveaways(specDir, told)).toEqual([
      'branch.json description: "eval"',
      'branch.json commit.body: "fixture"',
      `${path.join('files', 'src', 'told.ts')}: "Sample"`,
    ]);
  });

  it('is empty for a branch that reads as ordinary work', async () => {
    const specDir = path.join(root, 'quiet');
    write(path.join(specDir, 'files', 'src', 'ok.ts'), 'export const ok = 1;\n');
    expect(await giveaways(specDir, DiagramBranchSpecSchema.parse(spec))).toEqual([]);
  });
});

describe('the committed branches', () => {
  it('each parse and give nothing away, in their spec or their files', async () => {
    const repo = process.cwd();
    for (const name of await listDiagramBranches(repo)) {
      const specDir = path.join(repo, DIAGRAM_CONTRIVED_DIR, name);
      const committed = await readDiagramSpec(specDir);
      expect({ name, told: await giveaways(specDir, committed) }).toEqual({ name, told: [] });
    }
  });
});
