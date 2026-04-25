import type { NarrativeReview } from '@enhanced-review/review-types';

import type { CloneTarget } from '../clone/clone-runner';
import type { PrData } from '../prompt/types';

/**
 * The interface every review executor satisfies. Phase 4 ships only the
 * opencode implementation; the Claude-Code-SDK swap-in is one more file.
 */

export interface ReviewExecutorInput {
  cloneDir: string;
  prData: PrData;
  /** The diff that was already passed through file-filtering. */
  filteredDiff: string;
  target: CloneTarget;
  signal: AbortSignal;
  /** Model identifier in `<provider>/<model>` form (e.g. `opencode-zen/glm-4.7`). */
  model: string;
}

export interface ReviewExecutorOutput {
  review: NarrativeReview;
  wasTruncated: boolean;
  /**
   * The model's raw textual output, captured for diagnostics. Truncated
   * by the persistence layer if needed; never stored in `error_message`
   * (length-bounded).
   */
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
