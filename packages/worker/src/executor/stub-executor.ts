import { setTimeout as delay } from 'node:timers/promises';
import type { NarrativeReview } from '@enhanced-review/review-types';

import {
  type ReviewExecutor,
  type ReviewExecutorInput,
  type ReviewExecutorOutput,
} from './types';

/**
 * Dev-mode executor that emits a synthetic `<narrative_review>` payload
 * over multiple `onChunk` calls so the streaming + partial-parse path is
 * exercised end-to-end without a real `opencode` binary. The final
 * NarrativeReview returned by `run()` is the same shape the renderer
 * sees in production.
 *
 * The chapter titles are revealed gradually so the frontend partial
 * parser shows the typing-cursor checklist forming in real time.
 *
 * Triggered by `REVIEW_EXECUTOR=stub`. Replaces the Phase 3 direct
 * `insertChunk` loop in `runStubJob`, so dev tests catch streaming
 * regressions instead of waiting for live-fire.
 */

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

/** Default per-fragment delay so the stream is observable in a demo. */
const DEFAULT_FRAGMENT_DELAY_MS = 600;

export interface StubExecutorDeps {
  /** Test seam for sleeping between fragments. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-fragment delay. */
  fragmentDelayMs?: number;
  /** Override the synthetic payload (for tests). */
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
      // Use a cancellable delay so cancellation doesn't have to wait the
      // full window between fragments.
      await sleepCancellable(sleep, fragmentDelayMs, input.signal);
    }

    return { review, wasTruncated: false, rawText };
  }
}

/**
 * Split a NarrativeReview into stream fragments such that chapter titles
 * appear progressively (cursor in checklist UI) and the full payload is
 * exactly recoverable by `parseNarrativeReview` once concatenated.
 */
function buildFragments(review: NarrativeReview): string[] {
  const fragments: string[] = [];
  fragments.push('<narrative_review>{');
  fragments.push(`"prTitle":${JSON.stringify(review.prTitle)},`);
  fragments.push(`"overviewSummary":${JSON.stringify(review.overviewSummary)},`);
  fragments.push('"chapters":[');
  review.chapters.forEach((chapter, idx) => {
    if (idx > 0) fragments.push(',');
    // Open the chapter object and emit `id` first, then the `title`. The
    // title is intentionally split so the partial parser sees it land in
    // a single fragment (cursor → checkmark) rather than midway through.
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
