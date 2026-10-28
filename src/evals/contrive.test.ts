import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BranchSpecSchema, layBranch, listContrived, CONTRIVED_DIR } from './contrive.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'er-contrive-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe('layBranch', () => {
  it('copies the branch’s files over the base and deletes what it removes', async () => {
    const specDir = path.join(root, 'spec');
    const work = path.join(root, 'work');
    write(path.join(work, 'src', 'a.ts'), 'base a\n');
    write(path.join(work, 'src', 'old.ts'), 'base old\n');
    write(path.join(work, 'README.md'), 'base readme\n');
    write(path.join(specDir, 'files', 'src', 'a.ts'), 'branch a\n');
    write(path.join(specDir, 'files', 'src', 'new.ts'), 'branch new\n');
    await layBranch(
      specDir,
      BranchSpecSchema.parse({
        branch: 'feat/x',
        title: 't',
        description: '',
        commit: { subject: 's', body: '' },
        removed: ['src/old.ts'],
      }),
      work,
    );
    expect(readFileSync(path.join(work, 'src', 'a.ts'), 'utf8')).toBe('branch a\n');
    expect(readFileSync(path.join(work, 'src', 'new.ts'), 'utf8')).toBe('branch new\n');
    expect(readFileSync(path.join(work, 'README.md'), 'utf8')).toBe('base readme\n');
    expect(existsSync(path.join(work, 'src', 'old.ts'))).toBe(false);
  });
});

describe('listContrived', () => {
  it('lists every branch and never the base', async () => {
    for (const name of ['base', 'logging', 'dead-code']) {
      mkdirSync(path.join(root, CONTRIVED_DIR, name), { recursive: true });
    }
    expect(await listContrived(root)).toEqual(['dead-code', 'logging']);
  });
});

describe('the committed branches', () => {
  it('each have a spec that says nothing about being a fixture', async () => {
    const repo = process.cwd();
    for (const name of await listContrived(repo)) {
      const text = readFileSync(path.join(repo, CONTRIVED_DIR, name, 'branch.json'), 'utf8');
      const spec = BranchSpecSchema.parse(JSON.parse(text));
      expect(`${spec.title}\n${spec.description}\n${spec.commit.body}`).not.toMatch(
        /fixture|contrived|eval|skim|sample|synthetic/i,
      );
    }
  });
});
