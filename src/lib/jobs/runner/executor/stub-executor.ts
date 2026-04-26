import { setTimeout as delay } from 'node:timers/promises';
import type { NarrativeReview } from '@enhanced-review/review-types';

import { type ReviewExecutor, type ReviewExecutorInput, type ReviewExecutorOutput } from './types';

const STUB_REVIEW: NarrativeReview = {
  prTitle: 'Stub review',
  overviewSummary:
    'This is a stub review produced by the dev-mode executor. The streaming path emits this payload across multiple chunks so the partial parser has something to react to.',
  chapters: [
    {
      id: 'stub-chapter-1',
      title: 'Shape of the change',
      insights: [
        {
          type: 'context',
          text: 'The diff touches a handful of files; the stub executor did not actually read them.',
        },
        {
          type: 'highlight',
          text: 'Phase 4 produces a real AI-generated narrative.',
        },
      ],
      diffChunks: [],
    },
    {
      id: 'stub-chapter-2',
      title: 'Risks and follow-ups',
      insights: [
        {
          type: 'rationale',
          text: 'No risk analysis is performed by the stub. Treat all PRs as low-risk for now.',
        },
      ],
      diffChunks: [],
    },
    {
      id: 'stub-chapter-3',
      title: 'Inline review',
      insights: [
        {
          type: 'context',
          text: 'No inline review chunks in the stub.',
        },
      ],
      diffChunks: [],
    },
  ],
};

const DEFAULT_FRAGMENT_DELAY_MS = 600;

export interface StubExecutorDeps {
  sleep?: (ms: number) => Promise<void>;
  fragmentDelayMs?: number;
  review?: NarrativeReview;
}

export class StubExecutor implements ReviewExecutor {
  readonly name = 'stub';

  constructor(private readonly deps: StubExecutorDeps = {}) {}

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    const sleep = this.deps.sleep ?? ((ms: number) => delay(ms));
    const fragmentDelayMs = this.deps.fragmentDelayMs ?? DEFAULT_FRAGMENT_DELAY_MS;
    const review = this.deps.review ?? STUB_REVIEW;

    const fragments = buildFragments(review);
    let rawText = '';

    for (const fragment of fragments) {
      if (input.signal.aborted) {
        const err = new Error('stub executor aborted');
        err.name = 'AbortError';
        throw err;
      }
      input.onChunk?.(fragment);
      rawText += fragment;
      await sleepCancellable(sleep, fragmentDelayMs, input.signal);
    }

    return { review, wasTruncated: false, rawText };
  }
}

function buildFragments(review: NarrativeReview): string[] {
  const fragments: string[] = [];
  fragments.push('<narrative_review>{');
  fragments.push(`"prTitle":${JSON.stringify(review.prTitle)},`);
  fragments.push(`"overviewSummary":${JSON.stringify(review.overviewSummary)},`);
  fragments.push('"chapters":[');
  review.chapters.forEach((chapter, idx) => {
    if (idx > 0) fragments.push(',');
    fragments.push(`{"id":${JSON.stringify(chapter.id)},`);
    fragments.push(`"title":${JSON.stringify(chapter.title)},`);
    fragments.push(`"insights":${JSON.stringify(chapter.insights)},`);
    fragments.push(`"diffChunks":${JSON.stringify(chapter.diffChunks)}}`);
  });
  fragments.push(']}');
  fragments.push('</narrative_review>');
  return fragments;
}

async function sleepCancellable(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await Promise.race([
    sleep(ms),
    new Promise<void>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]);
}

export { STUB_REVIEW };
