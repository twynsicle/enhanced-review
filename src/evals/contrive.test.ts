import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_TEST_TIMEOUT } from '../test/git-repo.ts';
import {
  BranchSpecSchema,
  layBranch,
  listBranches,
  withContrivedBranch,
  type ModelRepo,
} from './contrive.ts';

// Standing a branch up is real git — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

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

const spec = BranchSpecSchema.parse({
  branch: 'feat/x',
  title: 't',
  description: '',
  commit: { subject: 'Change a, add new, drop old', body: 'why' },
  removed: ['src/old.ts'],
});

/** A two-file base and a branch over it, under `root`. */
function tinyRepo(): { repo: ModelRepo; specDir: string } {
  const base = path.join(root, 'base');
  const specDir = path.join(root, 'spec');
  write(path.join(base, 'src', 'a.ts'), 'base a\n');
  write(path.join(base, 'src', 'old.ts'), 'base old\n');
  write(path.join(base, 'README.md'), 'base readme\n');
  write(path.join(specDir, 'files', 'src', 'a.ts'), 'branch a\n');
  write(path.join(specDir, 'files', 'src', 'new.ts'), 'branch new\n');
  const repo: ModelRepo = {
    base,
    name: 'tiny',
    importSubject: 'Import tiny',
    author: { name: 'A. Author', email: 'a@tiny.example', date: '2024-01-02T03:04:05Z' },
  };
  return { repo, specDir };
}

describe('layBranch', () => {
  it('copies the branch’s files over the base and deletes what it removes', async () => {
    const { specDir } = tinyRepo();
    const work = path.join(root, 'work');
    write(path.join(work, 'src', 'a.ts'), 'base a\n');
    write(path.join(work, 'src', 'old.ts'), 'base old\n');
    write(path.join(work, 'README.md'), 'base readme\n');
    await layBranch(specDir, spec, work);
    expect(readFileSync(path.join(work, 'src', 'a.ts'), 'utf8')).toBe('branch a\n');
    expect(readFileSync(path.join(work, 'src', 'new.ts'), 'utf8')).toBe('branch new\n');
    expect(readFileSync(path.join(work, 'README.md'), 'utf8')).toBe('base readme\n');
    expect(existsSync(path.join(work, 'src', 'old.ts'))).toBe(false);
  });
});

describe('listBranches', () => {
  it('lists every branch and never the base', async () => {
    for (const name of ['base', 'logging', 'wiring']) {
      mkdirSync(path.join(root, 'contrived', name), { recursive: true });
    }
    expect(await listBranches(path.join(root, 'contrived'))).toEqual(['logging', 'wiring']);
  });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

describe('withContrivedBranch', () => {
  it('stands the branch up over the base, measured from origin’s main, and removes it after', async () => {
    const { repo, specDir } = tinyRepo();
    let kept = '';
    const seen = await withContrivedBranch(repo, specDir, spec, async (work) => {
      kept = work;
      expect(path.basename(work)).toBe('tiny');
      expect(git(work, 'branch', '--show-current').trim()).toBe('feat/x');
      expect(git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD').trim()).toBe(
        'refs/remotes/origin/main',
      );
      expect(git(work, 'diff', '--name-status', 'origin/main...HEAD').trim().split('\n')).toEqual([
        'M\tsrc/a.ts',
        'A\tsrc/new.ts',
        'D\tsrc/old.ts',
      ]);
      expect(git(work, 'log', '-1', '--format=%an <%ae> %aI').trim()).toBe(
        'A. Author <a@tiny.example> 2024-01-02T03:04:05+00:00',
      );
      return 'done';
    });
    expect(seen).toBe('done');
    expect(existsSync(kept)).toBe(false);
  });

  it('removes the repository when the caller throws', async () => {
    const { repo, specDir } = tinyRepo();
    let kept = '';
    await expect(
      withContrivedBranch(repo, specDir, spec, (work) => {
        kept = work;
        return Promise.reject(new Error('no'));
      }),
    ).rejects.toThrow('no');
    expect(existsSync(kept)).toBe(false);
  });
});
