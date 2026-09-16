import { describe, expect, it, vi } from 'vitest';
import type { GitRunner, GitRunOptions } from './clone/git-runner.server.ts';
import { STUB_REVIEW, StubExecutor } from './executor/stub-executor.server.ts';
import { finding, type Finding } from './findings.ts';
import {
  ExecutorParseError,
  type ReviewExecutor,
  type ReviewExecutorInput,
} from './executor/types.ts';
import {
  formatJobError,
  PullMetadataError,
  runJob,
  SHUTDOWN_ERROR_MESSAGE,
  type RunJobDeps,
  type RunJobInput,
  type RunJobStore,
} from './run.server.ts';
import type { NarrativeReview } from './narrative.ts';
import type { ReviewTarget } from './target.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

const BRANCH: ReviewTarget = {
  kind: 'branch',
  owner: 'acme',
  repo: 'widgets',
  ref: 'feature',
  baseRef: 'main',
  headSha: HEAD,
  baseSha: BASE,
};

const PR: ReviewTarget = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  headSha: HEAD,
  baseSha: BASE,
  title: 'Stored title',
};

const DIFF = `diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
-hi
+bye
`;

/** A git that answers every step the runner takes, recording the argv list. */
function fakeGit(headSha = HEAD): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (opts: GitRunOptions) => {
    calls.push([...opts.args]);
    const [cmd, ...rest] = opts.args;
    let stdout = '';
    if (cmd === 'rev-parse') stdout = `${headSha}\n`;
    else if (cmd === 'diff' && rest.includes('--numstat')) stdout = '1\t1\tf.txt\0';
    else if (cmd === 'diff' && rest.includes('--name-status')) stdout = 'M\0f.txt\0';
    else if (cmd === 'diff') stdout = DIFF;
    else if (cmd === 'log') stdout = 'Alice\n--BODY--\nfeature commit\n\nmore body\n';
    return { stdout, stderr: '', exitCode: 0 };
  };
  return { git, calls };
}

/** NUL-separated git output: every record, plus the trailing separator git writes. */
const z = (...records: string[]) => records.join('\u0000') + '\u0000';

const fetchFailsGit: GitRunner = async (opts) =>
  opts.args[0] === 'fetch'
    ? { stdout: '', stderr: 'fatal: could not read Username\nmore\n', exitCode: 128 }
    : { stdout: '', stderr: '', exitCode: 0 };

function fakeStore(overrides: Partial<RunJobStore> = {}) {
  const chunks: Array<{ seq: number; content: string }> = [];
  const store = {
    markRunning: vi.fn<RunJobStore['markRunning']>().mockResolvedValue(true),
    insertChunk: vi
      .fn<RunJobStore['insertChunk']>()
      .mockImplementation(async (_id, seq, content) => {
        chunks.push({ seq, content });
      }),
    finalizeDone: vi.fn<RunJobStore['finalizeDone']>().mockResolvedValue(true),
    markErrored: vi.fn<RunJobStore['markErrored']>().mockResolvedValue(true),
    ...overrides,
  };
  return { store, chunks };
}

function deps(overrides: Partial<RunJobDeps> = {}): RunJobDeps & { calls: string[][] } {
  const { git, calls } = fakeGit();
  return {
    executor: new StubExecutor({ fragmentDelayMs: 0 }),
    git,
    cloneUrlFor: (t) => `fake://${t.owner}/${t.repo}`,
    getPullMetadata: vi.fn().mockResolvedValue({
      ok: true,
      data: { title: 'Live title', body: 'PR body', authorLogin: 'alice' },
    }),
    makeWorkDir: async (jobId) => `/fake/work/${jobId}`,
    calls,
    ...overrides,
  };
}

function input(target: ReviewTarget, signal = new AbortController().signal): RunJobInput {
  return { jobId: 'job-1', token: 'tok', target, headSha: HEAD, model: 'm', signal };
}

/** An executor that captures its input and yields to a callback mid-run. */
function capturingExecutor(
  onRun: (input: ReviewExecutorInput) => Promise<void> | void,
  result: 'review' | Error = 'review',
): ReviewExecutor & { input?: ReviewExecutorInput } {
  const exec: ReviewExecutor & { input?: ReviewExecutorInput } = {
    name: 'capturing',
    async run(i) {
      exec.input = i;
      await onRun(i);
      if (result instanceof Error) throw result;
      return { review: STUB_REVIEW, wasTruncated: false, rawText: '', findings: [] };
    },
  };
  return exec;
}

describe('runJob', () => {
  it('runs a branch target end to end: git steps, chunks from seq 0, finalize with files', async () => {
    const { store, chunks } = fakeStore();
    const d = deps({ store });

    await expect(runJob(input(BRANCH), d)).resolves.toBe('done');

    expect(store.markRunning).toHaveBeenCalledWith('job-1');
    expect(d.calls.map((c) => c.join(' '))).toEqual([
      'init --quiet',
      'remote add origin fake://acme/widgets',
      'fetch --depth=1 origin feature',
      'checkout --quiet FETCH_HEAD',
      'rev-parse HEAD',
      `fetch --depth=1 origin ${BASE}`,
      `diff --no-color --no-ext-diff --no-textconv ${BASE}..${HEAD}`,
      `diff --numstat -z --no-color --no-ext-diff --no-textconv ${BASE}..${HEAD}`,
      `diff --name-status -z --no-color --no-ext-diff --no-textconv ${BASE}..${HEAD}`,
      `check-attr --source=${HEAD} -z linguist-generated linguist-vendored -- f.txt`,
      'log -1 --format=%an%n--BODY--%n%B',
    ]);
    expect(d.getPullMetadata).not.toHaveBeenCalled();

    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));

    expect(store.finalizeDone).toHaveBeenCalledTimes(1);
    const [, finalizeInput] = vi.mocked(store.finalizeDone).mock.calls[0] ?? [];
    expect(finalizeInput).toMatchObject({
      diffTruncated: false,
      riskScore: 2,
      findings: [],
      content: {
        prTitle: 'Stub review',
        files: [{ filename: 'f.txt', status: 'modified', additions: 1, deletions: 1 }],
      },
    });
    expect(store.markErrored).not.toHaveBeenCalled();
  });

  it('stores what validating the answer found, beside the review itself', async () => {
    const findings: Finding[] = [
      finding('diff-truncated', 'Part of the change was never shown to the reviewer.'),
    ];
    const executor: ReviewExecutor = {
      name: 'fake',
      run: async () => ({ review: STUB_REVIEW, wasTruncated: true, rawText: '', findings }),
    };
    const { store } = fakeStore();

    await expect(runJob(input(BRANCH), deps({ store, executor }))).resolves.toBe('done');

    const [, finalizeInput] = vi.mocked(store.finalizeDone).mock.calls[0] ?? [];
    expect(finalizeInput).toMatchObject({ findings, diffTruncated: true });
  });

  it('records why the prompt left a file out, rather than storing it as unmentioned', async () => {
    // The prompt filters lockfiles, and git has no text to diff for a binary
    // file: neither reaches the model, and a reviewed-looking row for either
    // is a change the reader is told nobody discussed.
    const git: GitRunner = async (opts) => {
      const [cmd, ...rest] = opts.args;
      if (cmd === 'rev-parse') return { stdout: `${HEAD}\n`, stderr: '', exitCode: 0 };
      if (cmd === 'diff' && rest.includes('--numstat')) {
        const stdout = z('1\t1\tf.txt', '9\t9\tyarn.lock', '-\t-\tlogo.png');
        return { stdout, stderr: '', exitCode: 0 };
      }
      if (cmd === 'diff' && rest.includes('--name-status')) {
        const stdout = z('M', 'f.txt', 'M', 'yarn.lock', 'A', 'logo.png');
        return { stdout, stderr: '', exitCode: 0 };
      }
      if (cmd === 'diff') return { stdout: DIFF, stderr: '', exitCode: 0 };
      if (cmd === 'log') return { stdout: `Alice\n--BODY--\na commit\n`, stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const { store } = fakeStore();
    await runJob(input(BRANCH), deps({ store, git }));

    const [, finalizeInput] = vi.mocked(store.finalizeDone).mock.calls[0] ?? [];
    const files = (finalizeInput?.content as NarrativeReview | undefined)?.files ?? [];
    expect(files.map((file) => [file.filename, file.skipped])).toEqual([
      ['f.txt', undefined],
      ['yarn.lock', 'built-in'],
      ['logo.png', 'binary'],
    ]);
  });

  it('records the marks the reviewed repository makes in its own .gitattributes', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (opts) => {
      calls.push([...opts.args]);
      const [cmd, ...rest] = opts.args;
      if (cmd === 'rev-parse') return { stdout: `${HEAD}\n`, stderr: '', exitCode: 0 };
      if (cmd === 'check-attr') {
        const stdout = z(
          'f.txt',
          'linguist-generated',
          'unspecified',
          'f.txt',
          'linguist-vendored',
          'unspecified',
          'api/client.gen.ts',
          'linguist-generated',
          'set',
          'api/client.gen.ts',
          'linguist-vendored',
          'unspecified',
        );
        return { stdout, stderr: '', exitCode: 0 };
      }
      if (cmd === 'diff' && rest.includes('--numstat')) {
        return { stdout: z('1\t1\tf.txt', '2\t0\tapi/client.gen.ts'), stderr: '', exitCode: 0 };
      }
      if (cmd === 'diff' && rest.includes('--name-status')) {
        return { stdout: z('M', 'f.txt', 'M', 'api/client.gen.ts'), stderr: '', exitCode: 0 };
      }
      if (cmd === 'diff') return { stdout: DIFF, stderr: '', exitCode: 0 };
      if (cmd === 'log') return { stdout: `Alice\n--BODY--\na commit\n`, stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const { store } = fakeStore();
    await runJob(input(BRANCH), deps({ store, git }));

    const [, finalizeInput] = vi.mocked(store.finalizeDone).mock.calls[0] ?? [];
    const files = (finalizeInput?.content as NarrativeReview | undefined)?.files ?? [];
    expect(files.map((file) => [file.filename, file.skipped])).toEqual([
      ['f.txt', undefined],
      ['api/client.gen.ts', 'generated'],
    ]);
    // Pinned to the commit under review: the clone is clean, but the same read
    // runs against the engineer's own tree in a local review.
    expect(calls.find((args) => args[0] === 'check-attr')).toEqual([
      'check-attr',
      `--source=${HEAD}`,
      '-z',
      'linguist-generated',
      'linguist-vendored',
      '--',
      'f.txt',
      'api/client.gen.ts',
    ]);
  });

  it('feeds branch commit metadata and the diff into the executor', async () => {
    const exec = capturingExecutor(() => {});
    const { store } = fakeStore();
    await runJob(input(BRANCH), deps({ store, executor: exec }));
    expect(exec.input?.prData).toMatchObject({
      title: 'Branch feature',
      author: 'Alice',
      body: 'feature commit\n\nmore body',
      baseRefName: 'main',
      headRefName: 'feature',
      diff: DIFF,
    });
    expect(exec.input?.cloneDir).toBe('/fake/work/job-1');
    expect(exec.input?.model).toBe('m');
  });

  it('fetches PR metadata and clones pull/N/head for a PR target', async () => {
    const exec = capturingExecutor(() => {});
    const { store } = fakeStore();
    const d = deps({ store, executor: exec });

    await expect(runJob(input(PR), d)).resolves.toBe('done');

    expect(d.getPullMetadata).toHaveBeenCalledWith(
      'tok',
      { owner: 'acme', repo: 'widgets', number: 7 },
      expect.any(AbortSignal),
    );
    expect(d.calls).toContainEqual(['fetch', '--depth=1', 'origin', 'pull/7/head']);
    expect(exec.input?.prData).toMatchObject({
      title: 'Live title',
      body: 'PR body',
      author: 'alice',
      headRefName: 'pull/7/head',
    });
  });

  it('marks the job errored when PR metadata cannot be fetched', async () => {
    const { store } = fakeStore();
    const d = deps({
      store,
      getPullMetadata: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: 'not-found', status: 404 } }),
    });
    await expect(runJob(input(PR), d)).resolves.toBe('errored');
    expect(store.markErrored).toHaveBeenCalledWith(
      'job-1',
      'github: pull request metadata: not-found (404)',
    );
    expect(d.calls).toEqual([]);
  });

  it('returns skipped without cloning when the job is no longer pending', async () => {
    const { store } = fakeStore({ markRunning: vi.fn().mockResolvedValue(false) });
    const d = deps({ store });
    await expect(runJob(input(BRANCH), d)).resolves.toBe('skipped');
    expect(d.calls).toEqual([]);
    expect(store.finalizeDone).not.toHaveBeenCalled();
  });

  it('returns aborted immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('cancel');
    const { store } = fakeStore();
    await expect(runJob(input(BRANCH, controller.signal), deps({ store }))).resolves.toBe(
      'aborted',
    );
    expect(store.markRunning).not.toHaveBeenCalled();
  });

  it('errors with a clone message when the head SHA moved', async () => {
    const { store } = fakeStore();
    const { git } = fakeGit('c'.repeat(40));
    await expect(runJob(input(BRANCH), deps({ store, git }))).resolves.toBe('errored');
    expect(store.markErrored).toHaveBeenCalledWith(
      'job-1',
      expect.stringMatching(
        /^clone: head SHA changed since job submit .* Submit a fresh review\.$/,
      ),
    );
  });

  it('errors with the first stderr line when a git step fails', async () => {
    const { store } = fakeStore();
    await expect(runJob(input(BRANCH), deps({ store, git: fetchFailsGit }))).resolves.toBe(
      'errored',
    );
    expect(store.markErrored).toHaveBeenCalledWith(
      'job-1',
      'clone: git fetch head failed with exit 128: fatal: could not read Username',
    );
  });

  it('errors with a parse message when the executor cannot produce a review', async () => {
    const { store } = fakeStore();
    const exec = capturingExecutor(() => {}, new ExecutorParseError('no tags', 'raw'));
    await expect(runJob(input(BRANCH), deps({ store, executor: exec }))).resolves.toBe('errored');
    expect(store.markErrored).toHaveBeenCalledWith('job-1', 'parse: no tags');
  });

  it('cancel mid-executor: partial chunks are flushed and no status is written by the runner', async () => {
    const controller = new AbortController();
    const { store, chunks } = fakeStore();
    const exec = capturingExecutor((i) => {
      i.onChunk?.('<narrative_review>');
      controller.abort('cancel');
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    await expect(
      runJob(input(BRANCH, controller.signal), deps({ store, executor: exec })),
    ).resolves.toBe('aborted');
    expect(chunks).toEqual([{ seq: 0, content: '<narrative_review>' }]);
    expect(store.finalizeDone).not.toHaveBeenCalled();
    expect(store.markErrored).not.toHaveBeenCalled();
  });

  it('timeout mid-executor: nothing is written (the timeout already marked error)', async () => {
    const controller = new AbortController();
    const { store } = fakeStore();
    const exec = capturingExecutor(() => {
      controller.abort('timeout');
    });
    await expect(
      runJob(input(BRANCH, controller.signal), deps({ store, executor: exec })),
    ).resolves.toBe('aborted');
    expect(store.finalizeDone).not.toHaveBeenCalled();
    expect(store.markErrored).not.toHaveBeenCalled();
  });

  it('shutdown mid-executor: the runner marks the job interrupted', async () => {
    const controller = new AbortController();
    const { store } = fakeStore();
    const exec = capturingExecutor(() => {
      controller.abort('shutdown');
    });
    await expect(
      runJob(input(BRANCH, controller.signal), deps({ store, executor: exec })),
    ).resolves.toBe('aborted');
    expect(store.markErrored).toHaveBeenCalledWith('job-1', SHUTDOWN_ERROR_MESSAGE);
  });

  it('returns skipped when finalize finds the job no longer running', async () => {
    const { store } = fakeStore({ finalizeDone: vi.fn().mockResolvedValue(false) });
    await expect(runJob(input(BRANCH), deps({ store }))).resolves.toBe('skipped');
    expect(store.markErrored).not.toHaveBeenCalled();
  });

  it('a failing chunk insert is logged, not fatal', async () => {
    const { store } = fakeStore({
      insertChunk: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(runJob(input(BRANCH), deps({ store }))).resolves.toBe('done');
  });
});

describe('formatJobError', () => {
  it('prefixes known failure classes and passes plain errors through', () => {
    expect(formatJobError(new PullMetadataError({ kind: 'unknown', message: 'boom' }))).toBe(
      'github: boom',
    );
    expect(formatJobError(new Error('plain'))).toBe('plain');
    expect(formatJobError('string')).toBe('string');
  });
});
