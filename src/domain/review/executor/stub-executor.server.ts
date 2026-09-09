import { setTimeout as delay } from 'node:timers/promises';
import type { NarrativeReview } from '../narrative.ts';
import {
  abortError,
  type ReviewExecutor,
  type ReviewExecutorInput,
  type ReviewExecutorOutput,
} from './types.ts';

/**
 * Replays a canned review as a stream of JSON fragments, pausing between
 * them, so the live view's partial parser and the chunk pipeline get
 * exercised without a model. `REVIEW_EXECUTOR=stub` (the local default) and
 * every test use it.
 */
export const STUB_REVIEW: NarrativeReview = {
  prTitle: 'Stub review',
  overviewSummary:
    'This is a stub review produced by the dev-mode executor. The streaming path emits this payload across multiple chunks so the partial parser has something to react to.',
  riskAssessment: {
    score: 2,
    summary:
      'Low risk: stub output exercises the review pipeline without touching production code.',
    rationale:
      'The stub executor does not inspect a real diff, so this rating is only a development placeholder. It represents a low-risk review with no data, availability, compliance, or customer workflow impact.',
    factors: [
      {
        name: 'Executor mode',
        impact: 'lowers',
        detail: 'Stub mode emits a fixed payload instead of evaluating production changes.',
      },
      {
        name: 'Test coverage',
        impact: 'neutral',
        detail: 'No diff-specific tests are visible to the stub executor.',
      },
      {
        name: 'Operational risk',
        impact: 'lowers',
        detail: 'The payload is limited to local review UI and streaming behavior.',
      },
    ],
  },
  files: [],
  chapters: [
    {
      id: 'stub-chapter-1',
      title: 'Shape of the change',
      description:
        'The stub review stands in for a real model response while the app exercises the job and streaming flow. It keeps the chapter structure realistic enough for UI testing without pretending to inspect the patch.',
      insights: [
        {
          type: 'context',
          title: 'Stub did not read the diff',
          text: 'The diff touches a handful of files; the stub executor did not actually read them.',
        },
        {
          type: 'highlight',
          title: 'The Claude executor produces the real review',
          text: 'Set REVIEW_EXECUTOR=claude to get an AI-generated narrative.',
        },
      ],
      diffChunks: [],
    },
    {
      id: 'stub-chapter-2',
      title: 'Risks and follow-ups',
      description:
        'This chapter represents the kind of tradeoff-focused explanation the real reviewer provides. In stub mode there is no underlying analysis, so the section is intentionally generic.',
      insights: [
        {
          type: 'rationale',
          title: 'No real risk analysis in stub mode',
          text: 'No risk analysis is performed by the stub. Treat all PRs as low-risk for now.',
        },
      ],
      diffChunks: [],
    },
    {
      id: 'stub-chapter-3',
      title: 'Inline review',
      description:
        'Inline diffs are empty in the stub response because there are no model-selected hunks. Real reviews attach selected changed hunks so the reader can inspect the code next to the narrative.',
      insights: [
        {
          type: 'context',
          title: 'Inline review chunks are absent',
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
  readonly #deps: StubExecutorDeps;

  constructor(deps: StubExecutorDeps = {}) {
    this.#deps = deps;
  }

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    const sleep = this.#deps.sleep ?? ((ms: number) => delay(ms));
    const fragmentDelayMs = this.#deps.fragmentDelayMs ?? DEFAULT_FRAGMENT_DELAY_MS;
    const review = this.#deps.review ?? STUB_REVIEW;

    let rawText = '';
    for (const fragment of buildFragments(review)) {
      if (input.signal.aborted) throw abortError('stub executor aborted');
      input.onChunk?.(fragment);
      rawText += fragment;
      await sleepCancellable(sleep, fragmentDelayMs, input.signal);
    }
    return { review, wasTruncated: false, rawText };
  }
}

/** Splits the review into the fragments a model would plausibly stream. */
export function buildFragments(review: NarrativeReview): string[] {
  const fragments: string[] = ['<narrative_review>{'];
  fragments.push(`"prTitle":${JSON.stringify(review.prTitle)},`);
  fragments.push(`"overviewSummary":${JSON.stringify(review.overviewSummary)},`);
  fragments.push(`"riskAssessment":${JSON.stringify(review.riskAssessment)},`);
  fragments.push(`"files":${JSON.stringify(review.files ?? [])},`);
  fragments.push('"chapters":[');
  review.chapters.forEach((chapter, idx) => {
    if (idx > 0) fragments.push(',');
    fragments.push(`{"id":${JSON.stringify(chapter.id)},`);
    fragments.push(`"title":${JSON.stringify(chapter.title)},`);
    fragments.push(`"description":${JSON.stringify(chapter.description ?? '')},`);
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
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
  ]);
}
