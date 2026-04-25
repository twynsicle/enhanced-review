import { describe, expect, it } from 'vitest';

import {
  HeadShaMismatchError,
  cleanupWorkDir,
  cloneAndDiff,
  type CloneInput,
} from './clone-runner';
import { GitCommandError, type GitRunOptions, type GitRunResult } from './git-runner';

interface FakeRunResponse {
  match: (args: readonly string[]) => boolean;
  result: GitRunResult;
}

function fakeRunner(responses: FakeRunResponse[]) {
  const calls: GitRunOptions[] = [];
  const runner = async (opts: GitRunOptions): Promise<GitRunResult> => {
    calls.push(opts);
    const match = responses.find((r) => r.match(opts.args));
    if (!match) {
      throw new Error(`fake runner: no response matches args: ${opts.args.join(' ')}`);
    }
    return match.result;
  };
  return { runner, calls };
}

const PR_INPUT: CloneInput = {
  jobId: 'j1',
  token: 'gho_secret',
  target: {
    kind: 'pr',
    owner: 'acme',
    repo: 'foo',
    headRef: 'feature/x',
    baseSha: 'b00b00b00',
  },
  expectedHeadSha: 'a11ce0',
};

describe('cloneAndDiff', () => {
  it('clones, verifies head, fetches base, returns diff', async () => {
    const { runner, calls } = fakeRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      {
        match: (a) => a[0] === 'rev-parse',
        result: { stdout: 'a11ce0\n', stderr: '', exitCode: 0 },
      },
      { match: (a) => a[0] === 'fetch', result: { stdout: '', stderr: '', exitCode: 0 } },
      {
        match: (a) => a[0] === 'diff',
        result: { stdout: 'diff --git a/x b/x\n', stderr: '', exitCode: 0 },
      },
    ]);

    const result = await cloneAndDiff(PR_INPUT, {
      gitRunner: runner,
      makeWorkDir: async () => '/tmp/fake',
    });

    expect(result.cloneDir).toBe('/tmp/fake');
    expect(result.diff).toBe('diff --git a/x b/x\n');
    expect(calls).toHaveLength(4);
  });

  it('embeds the token only in the clone URL, not in any other args', async () => {
    const { runner, calls } = fakeRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      {
        match: (a) => a[0] === 'rev-parse',
        result: { stdout: 'a11ce0\n', stderr: '', exitCode: 0 },
      },
      { match: (a) => a[0] === 'fetch', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff', result: { stdout: '', stderr: '', exitCode: 0 } },
    ]);

    await cloneAndDiff(PR_INPUT, {
      gitRunner: runner,
      makeWorkDir: async () => '/tmp/fake',
    });

    const cloneCall = calls.find((c) => c.args[0] === 'clone');
    const otherCalls = calls.filter((c) => c.args[0] !== 'clone');
    expect(cloneCall?.args.some((a) => a.includes('gho_secret'))).toBe(true);
    for (const call of otherCalls) {
      expect(call.args.some((a) => a.includes('gho_secret'))).toBe(false);
    }
  });

  it('throws HeadShaMismatchError when the cloned HEAD differs from expected', async () => {
    const { runner } = fakeRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      {
        match: (a) => a[0] === 'rev-parse',
        result: { stdout: 'someoth\n', stderr: '', exitCode: 0 },
      },
    ]);
    await expect(
      cloneAndDiff(PR_INPUT, {
        gitRunner: runner,
        makeWorkDir: async () => '/tmp/fake',
      }),
    ).rejects.toBeInstanceOf(HeadShaMismatchError);
  });

  it('throws GitCommandError on a non-zero exit, surfacing stderr without argv', async () => {
    const { runner } = fakeRunner([
      {
        match: (a) => a[0] === 'clone',
        result: { stdout: '', stderr: 'fatal: Authentication failed', exitCode: 128 },
      },
    ]);
    let caught: unknown;
    try {
      await cloneAndDiff(PR_INPUT, {
        gitRunner: runner,
        makeWorkDir: async () => '/tmp/fake',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitCommandError);
    if (caught instanceof GitCommandError) {
      expect(caught.stderr).toContain('Authentication failed');
      expect(caught.message).not.toContain('gho_secret');
    }
  });

  it('treats branch targets the same way using the branch ref + base sha', async () => {
    const { runner, calls } = fakeRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      {
        match: (a) => a[0] === 'rev-parse',
        result: { stdout: 'a11ce0\n', stderr: '', exitCode: 0 },
      },
      { match: (a) => a[0] === 'fetch', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff', result: { stdout: '', stderr: '', exitCode: 0 } },
    ]);
    await cloneAndDiff(
      {
        ...PR_INPUT,
        target: {
          kind: 'branch',
          owner: 'acme',
          repo: 'foo',
          ref: 'feature/x',
          baseRef: 'main',
          baseSha: 'b00b00b00',
        },
      },
      { gitRunner: runner, makeWorkDir: async () => '/tmp/fake' },
    );

    const cloneCall = calls.find((c) => c.args[0] === 'clone')!;
    expect(cloneCall.args).toContain('feature/x');
    const fetchCall = calls.find((c) => c.args[0] === 'fetch')!;
    expect(fetchCall.args).toContain('b00b00b00');
  });
});

describe('cleanupWorkDir', () => {
  it('does not throw when the directory does not exist', async () => {
    await expect(cleanupWorkDir('/nonexistent/path/that/should/not/exist')).resolves.toBeUndefined();
  });
});
