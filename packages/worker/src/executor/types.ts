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
  /**
   * Streaming hook. Invoked for every stdout `data` event the executor
   * receives, with the chunk decoded as UTF-8. The receiver is the
   * worker's chunk batcher, which assigns `seq` and writes rows into
   * `review_chunks`. Order matches the underlying stdout order.
   *
   * If `onChunk` itself throws (e.g. the batcher hit the per-job cap),
   * the executor must propagate the error so the job is failed cleanly.
   */
  onChunk?: (text: string) => void;
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
