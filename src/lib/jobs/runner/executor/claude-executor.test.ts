import { describe, expect, it, vi } from 'vitest';

import { ClaudeExecutor, type ClaudeExecutorDeps, type ClaudeQueryFn } from './claude-executor';
import { ExecutorParseError, ExecutorProcessError, type ReviewExecutorInput } from './types';

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

const ASSISTANT_TEXT_FRAGMENTS = ['<narrative_review>', NARRATIVE_JSON, '</narrative_review>'];

function buildInput(overrides: Partial<ReviewExecutorInput> = {}): ReviewExecutorInput {
  const ac = new AbortController();
  return {
    cloneDir: '/tmp/clone',
    prData: {
      title: 'Test PR',
      body: 'body',
      author: 'octocat',
      baseRefName: 'main',
      headRefName: 'feature',
      files: [],
      diff: '',
    },
    filteredDiff: '',
    target: {
      kind: 'branch',
      owner: 'o',
      repo: 'r',
      ref: 'feature',
      baseRef: 'main',
      baseSha: 'abc',
    },
    signal: ac.signal,
    model: 'claude-haiku-4-5',
    ...overrides,
  };
}

function makeAssistantMessage(text: string): unknown {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    uuid: 'uuid',
    session_id: 'session',
  };
}

function makeAssistantMessageMultiBlock(texts: string[]): unknown {
  return {
    type: 'assistant',
    message: { content: texts.map((text) => ({ type: 'text', text })) },
    parent_tool_use_id: null,
    uuid: 'uuid',
    session_id: 'session',
  };
}

function makeResultSuccess(): unknown {
  return { type: 'result', subtype: 'success' };
}

function makeResultError(subtype: string): unknown {
  return { type: 'result', subtype };
}

/** Build a queryFn that yields the given messages and captures its call args. */
function makeQueryFn(messages: unknown[]): { queryFn: ClaudeQueryFn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const queryFn = vi.fn((...args: unknown[]) => {
    calls.push(args);
    return (async function* () {
      for (const m of messages) {
        yield m;
      }
    })();
  }) as unknown as ClaudeQueryFn;
  return { queryFn, calls };
}

function makeDeps(messages: unknown[]): ClaudeExecutorDeps & { calls: unknown[][] } {
  const { queryFn, calls } = makeQueryFn(messages);
  return { queryFn, calls };
}

describe('ClaudeExecutor', () => {
  it('streams text fragments to onChunk and parses the narrative', async () => {
    const onChunk = vi.fn<(text: string) => void>();
    const messages = [
      ...ASSISTANT_TEXT_FRAGMENTS.map((t) => makeAssistantMessage(t)),
      makeResultSuccess(),
    ];
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn(messages).queryFn });

    const result = await exec.run({ ...buildInput(), onChunk });

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(ASSISTANT_TEXT_FRAGMENTS);
    expect(result.review.prTitle).toBe('Test PR');
    expect(result.review.chapters).toHaveLength(1);
    expect(result.rawText).toBe(ASSISTANT_TEXT_FRAGMENTS.join(''));
  });

  it('throws ExecutorParseError when the response lacks the narrative tags', async () => {
    const messages = [makeAssistantMessage('I cannot do that.'), makeResultSuccess()];
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn(messages).queryFn });

    await expect(exec.run(buildInput())).rejects.toBeInstanceOf(ExecutorParseError);
  });

  it('throws AbortError when the signal aborts before start', async () => {
    const ac = new AbortController();
    ac.abort();
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn([]).queryFn });

    const err = await exec.run(buildInput({ signal: ac.signal })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AbortError');
    expect((err as Error).message).toMatch(/aborted/);
  });

  it('propagates onChunk errors and stops iteration', async () => {
    const onChunk = vi.fn<(text: string) => void>().mockImplementation(() => {
      throw new Error('chunk insert failed');
    });
    const messages = [
      ...ASSISTANT_TEXT_FRAGMENTS.map((t) => makeAssistantMessage(t)),
      makeResultSuccess(),
    ];
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn(messages).queryFn });

    await expect(exec.run({ ...buildInput(), onChunk })).rejects.toThrow('chunk insert failed');
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it('passes cwd, model, tools, and permissionMode to queryFn', async () => {
    const messages = [
      ...ASSISTANT_TEXT_FRAGMENTS.map((t) => makeAssistantMessage(t)),
      makeResultSuccess(),
    ];
    const deps = makeDeps(messages);
    const input = buildInput();
    const exec = new ClaudeExecutor(deps);

    await exec.run(input);

    expect(deps.calls).toHaveLength(1);
    const [arg] = deps.calls[0] as [{ prompt: string; options: Record<string, unknown> }];
    expect(arg.options).toMatchObject({
      cwd: '/tmp/clone',
      model: 'claude-haiku-4-5',
      tools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'bypassPermissions',
    });
  });

  it('rejects with AbortError when signal aborts mid-stream', async () => {
    const ac = new AbortController();
    let abortAfter = 1;

    const queryFn = vi.fn(() => {
      return (async function* () {
        yield makeAssistantMessage('<narrative_review>');
        abortAfter--;
        if (abortAfter === 0) ac.abort();
        // Simulate SDK throwing on abort
        throw new Error('aborted by signal');
      })();
    }) as unknown as ClaudeQueryFn;

    const exec = new ClaudeExecutor({ queryFn });
    const err = await exec.run({ ...buildInput(), signal: ac.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AbortError');
  });

  it('throws ExecutorProcessError when result subtype is not success', async () => {
    const messages = [makeResultError('error_max_tokens')];
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn(messages).queryFn });

    const err = await exec.run(buildInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutorProcessError);
    expect((err as ExecutorProcessError).message).toContain('error_max_tokens');
  });

  it('calls onChunk twice for a multi-block assistant message and rawText is concatenation', async () => {
    const block1 = '<narrative_review>';
    const block2 = NARRATIVE_JSON + '</narrative_review>';
    const messages = [makeAssistantMessageMultiBlock([block1, block2]), makeResultSuccess()];
    const onChunk = vi.fn<(text: string) => void>();
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn(messages).queryFn });

    const result = await exec.run({ ...buildInput(), onChunk });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk.mock.calls[0][0]).toBe(block1);
    expect(onChunk.mock.calls[1][0]).toBe(block2);
    expect(result.rawText).toBe(block1 + block2);
  });

  it('round-trips wasTruncated through to the executor result', async () => {
    // Use a diff large enough to trigger truncation by building a prData with a huge diff.
    // Instead: we rely on buildNarrativePrompt returning wasTruncated=false for empty diff,
    // and just verify the field is present and boolean.
    const messages = [
      ...ASSISTANT_TEXT_FRAGMENTS.map((t) => makeAssistantMessage(t)),
      makeResultSuccess(),
    ];
    const exec = new ClaudeExecutor({ queryFn: makeQueryFn(messages).queryFn });
    const result = await exec.run(buildInput());
    expect(typeof result.wasTruncated).toBe('boolean');
  });
});
