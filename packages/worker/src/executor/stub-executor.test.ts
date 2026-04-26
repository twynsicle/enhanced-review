import { describe, expect, it } from 'vitest';

import { parseNarrativeReview } from '../prompt/parse-narrative';
import { STUB_REVIEW, StubExecutor } from './stub-executor';
import type { ReviewExecutorInput } from './types';

const SAMPLE_DIFF = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n';

function makeInput(overrides?: Partial<ReviewExecutorInput>): ReviewExecutorInput {
  const ac = new AbortController();
  return {
    cloneDir: '/tmp/stub',
    prData: {
      title: 't',
      body: '',
      author: 'a',
      baseRefName: 'main',
      headRefName: 'feature',
      files: [],
      diff: SAMPLE_DIFF,
    },
    filteredDiff: SAMPLE_DIFF,
    target: { kind: 'branch', owner: 'a', repo: 'b', ref: 'feature', baseRef: 'main', baseSha: 'b0' },
    signal: ac.signal,
    model: 'stub',
    ...overrides,
  };
}

describe('StubExecutor', () => {
  it('emits the synthetic review across multiple onChunk calls and the concatenation parses', async () => {
    const fragments: string[] = [];
    const executor = new StubExecutor({
      sleep: async () => undefined,
      fragmentDelayMs: 0,
    });
    const result = await executor.run(
      makeInput({ onChunk: (text) => fragments.push(text) }),
    );

    expect(fragments.length).toBeGreaterThan(3);
    const joined = fragments.join('');
    const parsed = parseNarrativeReview(joined);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.prTitle).toBe(STUB_REVIEW.prTitle);
      expect(parsed.data.chapters.map((c) => c.title)).toEqual(
        STUB_REVIEW.chapters.map((c) => c.title),
      );
    }
    expect(result.review).toEqual(STUB_REVIEW);
    expect(result.wasTruncated).toBe(false);
  });

  it('throws an AbortError when the signal is already aborted at start', async () => {
    const ac = new AbortController();
    ac.abort();
    const executor = new StubExecutor({
      sleep: async () => undefined,
      fragmentDelayMs: 0,
    });
    await expect(executor.run(makeInput({ signal: ac.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('propagates onChunk throws (cap-exceeded surrogates)', async () => {
    const executor = new StubExecutor({
      sleep: async () => undefined,
      fragmentDelayMs: 0,
    });
    await expect(
      executor.run(
        makeInput({
          onChunk: () => {
            throw new Error('cap');
          },
        }),
      ),
    ).rejects.toThrow('cap');
  });
});
