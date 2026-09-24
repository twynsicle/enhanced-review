import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import type { ChangedFile } from './diff-files.ts';
import { runGit, runGitOrThrow } from './git-runner.ts';
import { skipReasons, toReviewFiles, type RunGit } from './skip-reasons.ts';

// Real git, a spawn per batch — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

let repo: TempRepo;

beforeEach(() => {
  repo = createTempRepo();
});
afterEach(() => {
  repo.cleanup();
});

const gitIn = (cwd: string): RunGit => {
  return async (args) => (await runGitOrThrow(runGit, args[0] ?? 'command', { args, cwd })).stdout;
};

const file = (filename: string, binary = false): ChangedFile => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 1,
  binary,
});

/**
 * A repository that marks its machine-written files from a subdirectory rather
 * than the root, which is where git's own lookup rules start to matter.
 */
function repoMarkingFromASubdirectory(): string {
  repo.write(
    'api/.gitattributes',
    '*.gen.ts linguist-generated\nthirdparty/** linguist-vendored\n',
  );
  repo.write('api/client.gen.ts', 'export const client = 1;\n');
  repo.write('api/thirdparty/lib.js', 'module.exports = {};\n');
  repo.write('api/hand-written.ts', 'export const hand = 1;\n');
  repo.write('src/also.gen.ts', 'export const also = 1;\n');
  return repo.commit('a repository that marks its own generated files');
}

describe('skipReasons', () => {
  it('honours a nested .gitattributes for the paths beneath it, and not for the rest', async () => {
    const head = repoMarkingFromASubdirectory();
    const reasons = await skipReasons(
      [
        file('api/client.gen.ts'),
        file('api/thirdparty/lib.js'),
        file('api/hand-written.ts'),
        file('src/also.gen.ts'),
      ],
      head,
      gitIn(repo.work),
    );

    expect(Object.fromEntries(reasons)).toEqual({
      'api/client.gen.ts': 'generated',
      'api/thirdparty/lib.js': 'vendored',
    });
  });

  it('reads the marks at the head commit, not from the working tree', async () => {
    const head = repoMarkingFromASubdirectory();
    // Both edits are uncommitted, so neither may change what a review of the
    // commit skips.
    repo.write('api/.gitattributes', '');
    repo.write('.gitattributes', 'src/*.gen.ts linguist-generated\n');
    const reasons = await skipReasons(
      [file('api/client.gen.ts'), file('src/also.gen.ts')],
      head,
      gitIn(repo.work),
    );

    expect(Object.fromEntries(reasons)).toEqual({ 'api/client.gen.ts': 'generated' });
  });

  it('layers the built-in list and the binary flag either side of the marks', async () => {
    const head = repoMarkingFromASubdirectory();
    const reasons = await skipReasons(
      [
        file('yarn.lock'),
        file('api/client.gen.ts'),
        file('assets/logo.png', true),
        file('api/hand-written.ts'),
      ],
      head,
      gitIn(repo.work),
    );

    expect(Object.fromEntries(reasons)).toEqual({
      'yarn.lock': 'built-in',
      'api/client.gen.ts': 'generated',
      'assets/logo.png': 'binary',
    });
  });

  it('asks git nothing when the built-in list already accounts for every file', async () => {
    const git = vi.fn<RunGit>();
    const reasons = await skipReasons([file('yarn.lock'), file('a.min.js')], 'HEAD', git);

    expect(git).not.toHaveBeenCalled();
    expect([...reasons.values()]).toEqual(['built-in', 'built-in']);
  });

  it('classifies every file of a change too large for one command line', async () => {
    const head = repoMarkingFromASubdirectory();
    // Two batches' worth of paths, to prove the split does not drop a file.
    const many = Array.from({ length: 400 }, (_, i) => file(`src/${'d'.repeat(60)}/f${i}.ts`));
    const reasons = await skipReasons([...many, file('api/client.gen.ts')], head, gitIn(repo.work));

    expect(Object.fromEntries(reasons)).toEqual({ 'api/client.gen.ts': 'generated' });
  });
});

describe('toReviewFiles', () => {
  it('carries each skipped file’s reason and leaves the reviewed ones bare', () => {
    const files = toReviewFiles(
      [file('src/keep.ts'), file('yarn.lock')],
      new Map([['yarn.lock', 'built-in' as const]]),
    );

    expect(files).toEqual([
      { filename: 'src/keep.ts', status: 'modified', additions: 1, deletions: 1 },
      {
        filename: 'yarn.lock',
        status: 'modified',
        additions: 1,
        deletions: 1,
        skipped: 'built-in',
      },
    ]);
  });
});
