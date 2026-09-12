import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempRepo } from '../test/git-repo.ts';
import {
  createRunFolder,
  hunkFileName,
  latestRunFolder,
  RUNS_DIR,
  runStamp,
} from './run-folder.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cli-test-runs-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const at = new Date(2026, 8, 11, 14, 30, 5);

describe('run folders', () => {
  it('stamps a run with the local time', () => {
    expect(runStamp(at)).toBe('20260911-143005');
  });

  it('gives a second run in the same second its own folder', async () => {
    const first = await createRunFolder(root, 'pr-7', at);
    const second = await createRunFolder(root, 'pr-7', at);
    expect(path.basename(first.folder)).toBe('20260911-143005');
    expect(path.basename(second.folder)).toBe('20260911-143005-2');
  });

  it('finds the newest run for a slug', async () => {
    await createRunFolder(root, 'pr-7', new Date(2026, 8, 10));
    await createRunFolder(root, 'pr-7', at);
    await createRunFolder(root, 'pr-7', at);
    mkdirSync(path.join(root, RUNS_DIR, 'pr-7', 'not-a-run'));
    expect(path.basename((await latestRunFolder(root, 'pr-7'))!.folder)).toBe('20260911-143005-2');
    expect(await latestRunFolder(root, 'pr-8')).toBeNull();
  });

  it('keeps the runs folder out of the repository’s status', async () => {
    const repo = createTempRepo();
    try {
      await createRunFolder(repo.work, 'staged', at);
      expect(readFileSync(path.join(repo.work, RUNS_DIR, '.gitignore'), 'utf8')).toContain('*');
      expect(repo.git('status', '--porcelain')).toBe('');
    } finally {
      repo.cleanup();
    }
  });
});

describe('hunkFileName', () => {
  it.each([
    ['src/app.ts', 'src/app.ts.diff'],
    ['docs/what: why?.md', 'docs/what_ why_.md.diff'],
    ['a<b>|c*"d".txt', 'a_b__c__d_.txt.diff'],
  ])('%s → %s', (filename, expected) => {
    expect(hunkFileName(filename)).toBe(expected);
  });
});
