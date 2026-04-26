import { describe, expect, it, vi } from 'vitest';

import { ClaudeExecutor, type ClaudeQueryFn } from './claude-executor';
import { ExecutorParseError, type ReviewExecutorInput } from './types';

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

function makeResultSuccess(): unknown {
  return { type: 'result', subtype: 'success' };
}

function fakeQueryFn(messages: unknown[]): ClaudeQueryFn {
  const fn = (() => {
    return (async function* () {
      for (const m of messages) {
        yield m;
      }
    })();
  }) as unknown as ClaudeQueryFn;
  return fn;
}

describe('ClaudeExecutor', () => {
  it('streams text fragments to onChunk and parses the narrative', async () => {
    const onChunk = vi.fn<(text: string) => void>();
    const messages = [
      ...ASSISTANT_TEXT_FRAGMENTS.map((t) => makeAssistantMessage(t)),
      makeResultSuccess(),
    ];
    const exec = new ClaudeExecutor({ queryFn: fakeQueryFn(messages) });

    const result = await exec.run({ ...buildInput(), onChunk });

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(ASSISTANT_TEXT_FRAGMENTS);
    expect(result.review.prTitle).toBe('Test PR');
    expect(result.review.chapters).toHaveLength(1);
    expect(result.rawText).toBe(ASSISTANT_TEXT_FRAGMENTS.join(''));
  });

  it('throws ExecutorParseError when the response lacks the narrative tags', async () => {
    const messages = [makeAssistantMessage('I cannot do that.'), makeResultSuccess()];
    const exec = new ClaudeExecutor({ queryFn: fakeQueryFn(messages) });

    await expect(exec.run(buildInput())).rejects.toBeInstanceOf(ExecutorParseError);
  });

  it('throws AbortError when the signal aborts before start', async () => {
    const ac = new AbortController();
    ac.abort();
    const exec = new ClaudeExecutor({ queryFn: fakeQueryFn([]) });

    await expect(exec.run(buildInput({ signal: ac.signal }))).rejects.toThrow(/aborted/);
  });

  it('propagates onChunk errors and stops iteration', async () => {
    const onChunk = vi.fn<(text: string) => void>().mockImplementation(() => {
      throw new Error('chunk insert failed');
    });
    const messages = [
      ...ASSISTANT_TEXT_FRAGMENTS.map((t) => makeAssistantMessage(t)),
      makeResultSuccess(),
    ];
    const exec = new ClaudeExecutor({ queryFn: fakeQueryFn(messages) });

    await expect(exec.run({ ...buildInput(), onChunk })).rejects.toThrow('chunk insert failed');
    expect(onChunk).toHaveBeenCalledTimes(1);
  });
});
