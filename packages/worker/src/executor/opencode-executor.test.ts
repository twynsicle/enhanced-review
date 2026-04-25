import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { OpencodeExecutor } from './opencode-executor';
import { ExecutorParseError, ExecutorProcessError, type ReviewExecutorInput } from './types';

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(opts: {
  stdoutText: string;
  stderrText?: string;
  exitCode: number;
  /** Defer the close so we can fire abort before output ends. */
  delayCloseMs?: number;
}): FakeChild {
  const child = new EventEmitter() as FakeChild;

  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });

  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = vi.fn();

  // Drive the streams asynchronously so the executor's listeners attach
  // before data fires.
  setImmediate(() => {
    stdout.push(opts.stdoutText);
    stdout.push(null);
    if (opts.stderrText) stderr.push(opts.stderrText);
    stderr.push(null);
    if (opts.delayCloseMs) {
      setTimeout(() => child.emit('close', opts.exitCode), opts.delayCloseMs);
    } else {
      setImmediate(() => child.emit('close', opts.exitCode));
    }
  });

  return child;
}

const SAMPLE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

function makeInput(overrides?: Partial<ReviewExecutorInput>): ReviewExecutorInput {
  const ac = new AbortController();
  return {
    cloneDir: '/tmp/fake',
    prData: {
      title: 'Test PR',
      body: '',
      author: 'tester',
      baseRefName: 'main',
      headRefName: 'feature',
      files: [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 }],
      diff: SAMPLE_DIFF,
    },
    filteredDiff: SAMPLE_DIFF,
    target: { kind: 'branch', owner: 'a', repo: 'b', ref: 'feature', baseRef: 'main', baseSha: 'b0' },
    signal: ac.signal,
    model: 'opencode-zen/glm-4.7',
    ...overrides,
  };
}

const VALID_MODEL_OUTPUT = `prelude logging that opencode might emit
<narrative_review>${JSON.stringify({
  prTitle: 'Test PR',
  overviewSummary: 'sum',
  chapters: [
    {
      id: 'c1',
      title: 'first',
      insights: [{ type: 'highlight', text: 'x' }],
      diffChunks: [{ filename: 'src/a.ts', language: 'ts', hunkIds: ['H0001'] }],
    },
  ],
})}</narrative_review>
trailing footer`;

describe('OpencodeExecutor', () => {
  it('parses a valid <narrative_review> response and returns wasTruncated=false', async () => {
    const child = makeFakeChild({ stdoutText: VALID_MODEL_OUTPUT, exitCode: 0 });
    const spawner = vi.fn().mockReturnValue(child);
    const writeConfig = vi.fn().mockResolvedValue({ configPath: 'opencode.json', agentsPath: 'AGENTS.md' });

    const executor = new OpencodeExecutor({ spawner, writeConfig });
    const result = await executor.run(makeInput());

    expect(result.review.prTitle).toBe('Test PR');
    expect(result.review.chapters).toHaveLength(1);
    expect(result.wasTruncated).toBe(false);
    expect(spawner).toHaveBeenCalledWith(
      'opencode',
      ['run', '--model', 'opencode-zen/glm-4.7'],
      expect.objectContaining({ cwd: '/tmp/fake' }),
    );
    expect(writeConfig).toHaveBeenCalledOnce();
  });

  it('throws ExecutorParseError when output has no review tags but the process exited cleanly', async () => {
    const child = makeFakeChild({ stdoutText: 'no review here', exitCode: 0 });
    const spawner = vi.fn().mockReturnValue(child);
    const executor = new OpencodeExecutor({
      spawner,
      writeConfig: vi.fn().mockResolvedValue({ configPath: '', agentsPath: '' }),
    });

    await expect(executor.run(makeInput())).rejects.toBeInstanceOf(ExecutorParseError);
  });

  it('throws ExecutorProcessError when opencode exits non-zero', async () => {
    const child = makeFakeChild({ stdoutText: '', stderrText: 'auth failed', exitCode: 7 });
    const spawner = vi.fn().mockReturnValue(child);
    const executor = new OpencodeExecutor({
      spawner,
      writeConfig: vi.fn().mockResolvedValue({ configPath: '', agentsPath: '' }),
    });

    let caught: unknown;
    try {
      await executor.run(makeInput());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExecutorProcessError);
    if (caught instanceof ExecutorProcessError) {
      expect(caught.exitCode).toBe(7);
      expect(caught.stderr).toBe('auth failed');
    }
  });

  it('SIGTERMs the child when the AbortSignal fires', async () => {
    // delayCloseMs gives us time to abort before the fake child closes.
    const child = makeFakeChild({ stdoutText: '', exitCode: 143, delayCloseMs: 50 });
    const spawner = vi.fn().mockReturnValue(child);
    const ac = new AbortController();

    const executor = new OpencodeExecutor({
      spawner,
      writeConfig: vi.fn().mockResolvedValue({ configPath: '', agentsPath: '' }),
    });

    const promise = executor.run(makeInput({ signal: ac.signal }));
    setImmediate(() => ac.abort());
    await expect(promise).rejects.toBeDefined();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
