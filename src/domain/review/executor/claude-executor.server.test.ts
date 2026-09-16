import type { HookInput, Options } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_ENV_KEYS, ClaudeExecutor, type ClaudeQueryFn } from './claude-executor.server.ts';
import { ExecutorParseError, ExecutorProcessError, type ReviewExecutorInput } from './types.ts';

const NARRATIVE_JSON = JSON.stringify({
  prTitle: 'Test PR',
  overviewSummary: { lede: 'A test summary.' },
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
      maxTurns: 60,
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

  it('fails a run that stopped early, however complete its answer looks', async () => {
    const { executor } = executorFor([
      ...FRAGMENTS.map((t) => assistant(t)),
      result('error_max_turns'),
    ]);
    const err = await executor.run(buildInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutorProcessError);
    expect((err as ExecutorProcessError).message).toContain('error_max_turns');
  });

  it('fails a stream that ends with no result at all', async () => {
    // The SDK sends a result for every way a run can finish, so a stream
    // without one stopped for a reason nobody recorded.
    const { executor } = executorFor(FRAGMENTS.map((t) => assistant(t)));
    const err = await executor.run(buildInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutorProcessError);
    expect((err as ExecutorProcessError).message).toContain('no result');
  });

  it('returns no findings for an answer that needed no repair', async () => {
    const { executor } = executorFor([...FRAGMENTS.map((t) => assistant(t)), result('success')]);
    await expect(executor.run(buildInput())).resolves.toMatchObject({ findings: [] });
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

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
+x
@@ -20,2 +21,3 @@
+y
`;

/** A review of `DIFF` citing exactly the hunks named. */
function answer(hunkIds: string[]): string {
  return `<narrative_review>${JSON.stringify({
    prTitle: 'Two hunks',
    overviewSummary: { lede: 'A summary.' },
    chapters: [
      {
        id: 'c1',
        title: 'The change',
        insights: [],
        diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds }],
      },
    ],
  })}</narrative_review>`;
}

function groundedInput(): ReviewExecutorInput {
  return {
    ...buildInput(),
    prData: {
      title: 'Two hunks',
      body: 'body',
      author: 'octocat',
      baseRefName: 'main',
      headRefName: 'feature',
      files: [{ filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 0 }],
      diff: DIFF,
    },
  };
}

/**
 * A query that answers, then submits to the Stop hook the way the SDK does:
 * a refusal sends it back for the next answer in the list, and the last
 * answer stands whatever the hook says of it.
 */
function answeringQueryFn(answers: string[], subtype = 'success') {
  const blocks: string[] = [];
  const queryFn = ((args: { prompt: string; options: Options }) =>
    (async function* () {
      for (const [index, text] of answers.entries()) {
        yield assistant(text);
        const hook = args.options.hooks?.Stop?.[0]?.hooks[0];
        if (!hook) throw new Error('no Stop hook was registered');
        const out = (await hook(
          {
            hook_event_name: 'Stop',
            stop_hook_active: index > 0,
            session_id: 's',
            transcript_path: 't',
            cwd: '.',
          } as HookInput,
          undefined,
          { signal: new AbortController().signal },
        )) as { decision?: string; reason?: string };
        if (out.decision !== 'block') break;
        blocks.push(String(out.reason));
      }
      yield result(subtype);
    })()) as unknown as ClaudeQueryFn;
  return { queryFn, blocks };
}

describe('the validation retry', () => {
  it('asks again when a hunk is cited by no chapter, naming the hunk', async () => {
    const { queryFn, blocks } = answeringQueryFn([answer(['H0001']), answer(['H0001', 'H0002'])]);
    const executor = new ClaudeExecutor({ queryFn, env: {} });

    const out = await executor.run(groundedInput());

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('H0002 (src/a.ts)');
    expect(blocks[0]).toContain('complete narrative review block again');
    expect(out.review.chapters[0]?.diffChunks[0]?.hunks.map((h) => h.id)).toEqual([
      'H0001',
      'H0002',
    ]);
    expect(out.findings).toEqual([
      expect.objectContaining({ code: 'passed-after-retry', severity: 'warning' }),
    ]);
  });

  it('gives up after three refusals and fails the review with what was still wrong', async () => {
    const { queryFn, blocks } = answeringQueryFn([
      answer(['H0001']),
      answer(['H0001']),
      answer(['H0001']),
      answer(['H0001']),
    ]);
    const executor = new ClaudeExecutor({ queryFn, env: {} });

    const err = await executor.run(groundedInput()).catch((e: unknown) => e);

    expect(blocks).toHaveLength(3);
    expect(err).toBeInstanceOf(ExecutorParseError);
    expect((err as ExecutorParseError).message).toContain('H0002 (src/a.ts)');
  });

  it('lets a complete first answer stop without asking anything', async () => {
    const { queryFn, blocks } = answeringQueryFn([answer(['H0001', 'H0002'])]);
    const executor = new ClaudeExecutor({ queryFn, env: {} });

    const out = await executor.run(groundedInput());

    expect(blocks).toEqual([]);
    expect(out.findings).toEqual([]);
  });
});
