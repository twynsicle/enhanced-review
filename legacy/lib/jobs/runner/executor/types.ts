import type { NarrativeReview } from '@enhanced-review/review-types';

import type { CloneTarget } from '../clone/clone-runner';
import type { PrData } from '../prompt/types';

export interface ReviewExecutorInput {
  cloneDir: string;
  prData: PrData;
  filteredDiff: string;
  target: CloneTarget;
  signal: AbortSignal;
  model: string;
  jobId: string;
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

export class ExecutorParseError extends Error {
  readonly rawText: string;
  constructor(message: string, rawText: string) {
    super(message);
    this.name = 'ExecutorParseError';
    this.rawText = rawText;
  }
}

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
