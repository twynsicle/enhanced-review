import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createTempRepo, GIT_TEST_TIMEOUT } from '../../../test/git-repo.ts';
import { GitCommandError, runGit, runGitOrThrow, type GitRunner } from './git-runner.server.ts';

vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT });

const okRunner: GitRunner = async () => ({ stdout: 'abc\n', stderr: '', exitCode: 0 });
const failingRunner: GitRunner = async () => ({
  stdout: '',
  stderr: 'fatal: not a git repository\n',
  exitCode: 128,
});

describe('runGitOrThrow', () => {
  it('returns the result when git exits 0', async () => {
    await expect(runGitOrThrow(okRunner, 'rev-parse', { args: ['rev-parse'] })).resolves.toEqual({
      stdout: 'abc\n',
      stderr: '',
      exitCode: 0,
    });
  });

  it('throws GitCommandError carrying stderr and the exit code otherwise', async () => {
    const err = await runGitOrThrow(failingRunner, 'diff', { args: ['diff'] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GitCommandError);
    expect((err as GitCommandError).message).toBe('git diff failed with exit 128');
    expect((err as GitCommandError).stderr).toContain('not a git repository');
    expect((err as GitCommandError).exitCode).toBe(128);
  });
});

describe('runGit', () => {
  it('spawns the host git and captures stdout', async () => {
    const result = await runGit({ args: ['--version'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^git version/);
  });

  it('reports a non-zero exit instead of throwing', async () => {
    const result = await runGit({ args: ['definitely-not-a-git-command'] });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('ignores a global setting that rewrites the diff, unless the caller asks for the host config', async () => {
    // `diff.noprefix` stands in for every ambient setting that can make the
    // `diff --git a/<path> b/<path>` line unmatchable: the hunk catalog reads
    // that line, so one of them on the host is the whole catalog gone.
    const repo = createTempRepo();
    const home = mkdtempSync(path.join(tmpdir(), 'git-home-'));
    try {
      writeFileSync(path.join(home, '.gitconfig'), '[diff]\n\tnoprefix = true\n');
      repo.write('f.txt', 'after\n');
      const head = repo.commit('change');
      const run = (hostConfig: boolean) =>
        runGit({
          args: ['diff', `${head}~1..${head}`],
          cwd: repo.work,
          env: { HOME: home, USERPROFILE: home },
          hostConfig,
        });

      const [ignored, honoured] = await Promise.all([run(false), run(true)]);
      expect(ignored.stdout).toContain('diff --git a/f.txt b/f.txt');
      expect(honoured.stdout).toContain('diff --git f.txt f.txt');
    } finally {
      rmSync(home, { recursive: true, force: true });
      repo.cleanup();
    }
  });
});
