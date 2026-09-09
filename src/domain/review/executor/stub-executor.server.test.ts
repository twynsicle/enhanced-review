import { describe, expect, it, vi } from 'vitest';
import { NarrativeReviewSchema } from '../narrative.ts';
import { parseNarrativeReview } from '../prompt/parse-narrative.ts';
import type { PrData } from '../prompt/types.ts';
import { buildFragments, STUB_REVIEW, StubExecutor } from './stub-executor.server.ts';
import type { ReviewExecutorInput } from './types.ts';

const PR_DATA: PrData = {
  title: 't',
  body: '',
  author: 'a',
  baseRefName: 'main',
  headRefName: 'feature',
  files: [],
  diff: '',
};

function input(overrides: Partial<ReviewExecutorInput> = {}): ReviewExecutorInput {
  return {
    jobId: 'job-1',
    cloneDir: '/tmp/clone',
    prData: PR_DATA,
    model: 'stub',
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('STUB_REVIEW', () => {
  it('satisfies the narrative schema', () => {
    expect(NarrativeReviewSchema.safeParse(STUB_REVIEW).success).toBe(true);
  });
});

describe('buildFragments', () => {
  it('concatenates back to a parseable narrative block', () => {
    const raw = buildFragments(STUB_REVIEW).join('');
    const parsed = parseNarrativeReview(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.data.prTitle).toBe('Stub review');
    expect(parsed.ok && parsed.data.chapters.map((c) => c.id)).toEqual(
      STUB_REVIEW.chapters.map((c) => c.id),
    );
  });
});

const neverResolves = () => new Promise<void>(() => {});

describe('StubExecutor', () => {
  it('streams every fragment through onChunk and returns the canned review', async () => {
    const onChunk = vi.fn<(text: string) => void>();
    const executor = new StubExecutor({ fragmentDelayMs: 0 });
    const result = await executor.run(input({ onChunk }));

    const fragments = buildFragments(STUB_REVIEW);
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(fragments);
    expect(result).toEqual({
      review: STUB_REVIEW,
      wasTruncated: false,
      rawText: fragments.join(''),
    });
    expect(executor.name).toBe('stub');
  });

  it('waits between fragments using the injected sleep', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    await new StubExecutor({ sleep, fragmentDelayMs: 25 }).run(input());
    expect(sleep).toHaveBeenCalledTimes(buildFragments(STUB_REVIEW).length);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it('throws AbortError and stops streaming once the signal aborts', async () => {
    const controller = new AbortController();
    const onChunk = vi.fn<(text: string) => void>().mockImplementation(() => {
      if (onChunk.mock.calls.length === 2) controller.abort('cancel');
    });
    const err = await new StubExecutor({ fragmentDelayMs: 0 })
      .run(input({ onChunk, signal: controller.signal }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AbortError');
    expect(onChunk).toHaveBeenCalledTimes(2);
  });

  it('interrupts a pending sleep when aborted', async () => {
    const controller = new AbortController();
    const run = new StubExecutor({ sleep: neverResolves, fragmentDelayMs: 1000 }).run(
      input({ signal: controller.signal }),
    );
    controller.abort('cancel');
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
