import type { NarrativeReview } from '../narrative.ts';
import type { PrData } from '../prompt/types.ts';

/**
 * An executor turns the cloned tree + diff into a `NarrativeReview`,
 * streaming raw model text through `onChunk` as it arrives. Two
 * implementations: the Claude Agent SDK (production) and a stub that replays
 * a canned review (local development, tests). `REVIEW_EXECUTOR` picks one.
 */
export interface ReviewExecutorInput {
  jobId: string;
  cloneDir: string;
  prData: PrData;
  model: string;
  signal: AbortSignal;
  onChunk?: (text: string) => void;
}

export interface ReviewExecutorOutput {
  review: NarrativeReview;
  wasTruncated: boolean;
  rawText: string;
}

export interface ReviewExecutor {
  readonly name: string;
  run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput>;
}

/** The model finished but its output was not a usable review. */
export class ExecutorParseError extends Error {
  readonly rawText: string;
  constructor(message: string, rawText: string) {
    super(message);
    this.name = 'ExecutorParseError';
    this.rawText = rawText;
  }
}

/** The SDK or subprocess failed before a review could be parsed. */
export class ExecutorProcessError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly rawText: string;
  constructor(message: string, stderr: string, exitCode: number | null, rawText: string) {
    super(message);
    this.name = 'ExecutorProcessError';
    this.stderr = stderr;
    this.exitCode = exitCode;
    this.rawText = rawText;
  }
}

/** The conventional shape thrown when `signal` aborts mid-run. */
export function abortError(message: string): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}
