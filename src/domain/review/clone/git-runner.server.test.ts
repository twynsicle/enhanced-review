import { describe, expect, it } from 'vitest';
import { GitCommandError, runGit, runGitOrThrow, type GitRunner } from './git-runner.server.ts';

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
});
