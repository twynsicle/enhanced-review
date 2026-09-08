import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_ENV_KEYS, ClaudeExecutor, type ClaudeQueryFn } from './claude-executor.server.ts';
import { ExecutorParseError, ExecutorProcessError, type ReviewExecutorInput } from './types.ts';

const NARRATIVE_JSON = JSON.stringify({
  prTitle: 'Test PR',
  overviewSummary: 'A test summary.',
  chapters: [
    {
      id: 'c1',
      title: 'Test chapter',
      insights: [{ type: 'context', text: 'A note.' }],
      diffChunks: [],
    },
  ],
});

const FRAGMENTS = ['<narrative_review>', NARRATIVE_JSON, '</narrative_review>'];

function buildInput(overrides: Partial<ReviewExecutorInput> = {}): ReviewExecutorInput {
  return {
    cloneDir: '/tmp/clone',
    jobId: 'test-job-id',
    prData: {
      title: 'Test PR',
      body: 'body',
      author: 'octocat',
      baseRefName: 'main',
      headRefName: 'feature',
      files: [],
      diff: '',
    },
    signal: new AbortController().signal,
    model: 'claude-haiku-4-5',
    ...overrides,
  };
}

function assistant(...texts: string[]): unknown {
  return {
    type: 'assistant',
    message: { content: texts.map((text) => ({ type: 'text', text })) },
    parent_tool_use_id: null,
    uuid: 'uuid',
    session_id: 'session',
  };
}

function result(subtype: string): unknown {
  return { type: 'result', subtype };
}

function makeQueryFn(messages: unknown[]): { queryFn: ClaudeQueryFn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const queryFn = vi.fn((...args: unknown[]) => {
    calls.push(args);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as ClaudeQueryFn;
  return { queryFn, calls };
}

function executorFor(messages: unknown[]) {
  const { queryFn, calls } = makeQueryFn(messages);
  return { executor: new ClaudeExecutor({ queryFn, env: { PATH: '/bin' } }), calls };
}

describe('ClaudeExecutor', () => {
  it('streams text fragments to onChunk and parses the narrative', async () => {
    const onChunk = vi.fn<(text: string) => void>();
    const { executor } = executorFor([...FRAGMENTS.map((t) => assistant(t)), result('success')]);

    const out = await executor.run({ ...buildInput(), onChunk });

    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(FRAGMENTS);
    expect(out.review.prTitle).toBe('Test PR');
    expect(out.review.chapters).toHaveLength(1);
    expect(out.rawText).toBe(FRAGMENTS.join(''));
    expect(out.wasTruncated).toBe(false);
  });

  it('throws ExecutorParseError when the response lacks the narrative tags', async () => {
    const { executor } = executorFor([assistant('I cannot do that.'), result('success')]);
    await expect(executor.run(buildInput())).rejects.toBeInstanceOf(ExecutorParseError);
  });

  it('throws AbortError when the signal aborts before start', async () => {
    const ac = new AbortController();
    ac.abort();
    const { executor, calls } = executorFor([]);
    await expect(executor.run(buildInput({ signal: ac.signal }))).rejects.toMatchObject({
      name: 'AbortError',
      message: expect.stringMatching(/aborted/) as string,
    });
    expect(calls).toHaveLength(0);
  });

  it('propagates onChunk errors and stops iteration', async () => {
    const onChunk = vi.fn<(text: string) => void>().mockImplementation(() => {
      throw new Error('chunk insert failed');
    });
    const { executor } = executorFor([...FRAGMENTS.map((t) => assistant(t)), result('success')]);
    await expect(executor.run({ ...buildInput(), onChunk })).rejects.toThrow('chunk insert failed');
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it('pins the SDK options: read-only tools, sandbox, no settings, no persisted session', async () => {
    const { executor, calls } = executorFor([
      ...FRAGMENTS.map((t) => assistant(t)),
      result('success'),
    ]);
    await executor.run(buildInput());

    expect(calls).toHaveLength(1);
    const [arg] = calls[0] as [{ prompt: string; options: Record<string, unknown> }];
    expect(arg.prompt).toContain('# Pull Request: Test PR');
    expect(arg.options).toMatchObject({
      cwd: '/tmp/clone',
      model: 'claude-haiku-4-5',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'dontAsk',
      settingSources: [],
      persistSession: false,
      maxTurns: 30,
      env: { PATH: '/bin' },
      sandbox: {
        enabled: true,
        failIfUnavailable: false,
        allowUnsandboxedCommands: false,
        filesystem: { allowRead: ['/tmp/clone'], denyWrite: ['/tmp/clone'] },
      },
    });
    expect(arg.options).not.toHaveProperty('allowDangerouslySkipPermissions');
    expect(arg.options['abortController']).toBeInstanceOf(AbortController);
    expect(String(arg.options['systemPrompt'])).toContain('freshly cloned working tree');
  });

  it('forwards only the allowlisted host variables by default', () => {
    expect(CLAUDE_ENV_KEYS).toContain('ANTHROPIC_API_KEY');
    expect(CLAUDE_ENV_KEYS).toContain('PATH');
    expect(CLAUDE_ENV_KEYS).not.toContain('DATABASE_URL');
    expect(CLAUDE_ENV_KEYS).not.toContain('SESSION_SECRET');
    expect(CLAUDE_ENV_KEYS).not.toContain('GITHUB_CLIENT_SECRET');
  });

  it('rejects with AbortError when the signal aborts mid-stream and the SDK throws', async () => {
    const ac = new AbortController();
    const queryFn = vi.fn(() =>
      (async function* () {
        yield assistant('<narrative_review>');
        ac.abort();
        throw new Error('aborted by signal');
      })(),
    ) as unknown as ClaudeQueryFn;

    const executor = new ClaudeExecutor({ queryFn, env: {} });
    await expect(executor.run({ ...buildInput(), signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects with AbortError when the signal aborts mid-stream and the SDK stops silently', async () => {
    const ac = new AbortController();
    const queryFn = vi.fn(() =>
      (async function* () {
        yield assistant('<narrative_review>');
        ac.abort();
      })(),
    ) as unknown as ClaudeQueryFn;

    const executor = new ClaudeExecutor({ queryFn, env: {} });
    await expect(executor.run({ ...buildInput(), signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('wraps SDK failures in ExecutorProcessError with the raw text so far', async () => {
    const queryFn = vi.fn(() =>
      (async function* () {
        yield assistant('partial');
        throw new Error('spawn failed');
      })(),
    ) as unknown as ClaudeQueryFn;
    const executor = new ClaudeExecutor({ queryFn, env: {} });
    const err = await executor.run(buildInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutorProcessError);
    expect((err as ExecutorProcessError).message).toBe('spawn failed');
    expect((err as ExecutorProcessError).rawText).toBe('partial');
  });

  it('throws ExecutorProcessError when the result is not success and parsing fails too', async () => {
    const { executor } = executorFor([result('error_max_turns')]);
    const err = await executor.run(buildInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutorProcessError);
    expect((err as ExecutorProcessError).message).toContain('error_max_turns');
  });

  it('returns the parsed review even when the SDK ends with a non-success result', async () => {
    const { executor } = executorFor([
      ...FRAGMENTS.map((t) => assistant(t)),
      result('error_max_turns'),
    ]);
    const out = await executor.run(buildInput());
    expect(out.review.prTitle).toBe('Test PR');
  });

  it('calls onChunk per text block of a multi-block message', async () => {
    const block1 = '<narrative_review>';
    const block2 = NARRATIVE_JSON + '</narrative_review>';
    const onChunk = vi.fn<(text: string) => void>();
    const { executor } = executorFor([assistant(block1, block2), result('success')]);

    const out = await executor.run({ ...buildInput(), onChunk });
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual([block1, block2]);
    expect(out.rawText).toBe(block1 + block2);
  });
});
