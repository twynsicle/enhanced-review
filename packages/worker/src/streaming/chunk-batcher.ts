import type { SupabaseClient } from '@supabase/supabase-js';

import { insertChunk } from '../writes';

/**
 * Buffers stdout fragments emitted by an executor and flushes them into
 * `review_chunks` on a 100ms-or-256-byte schedule, whichever fires
 * first. Per-job in-memory `seq` counter so chunks land in stable order
 * without DB-side coordination.
 *
 * The flow is intentionally one-way: the executor calls `onChunk(text)`
 * synchronously from a stdout 'data' event; we buffer in memory and a
 * Postgres INSERT happens off the critical path on the timer / threshold
 * trigger. `flush()` is idempotent and is called from a finally so the
 * tail makes it to the DB on cancel / error too.
 *
 * Backpressure: when total flushed-or-buffered chunk count would exceed
 * `maxChunks`, `onChunk` throws {@link StreamCapExceededError}. The
 * executor propagates that out; `runOpencodeJob` interprets it as
 * `error_message='stream cap exceeded'`. The cap is meant to catch
 * runaway streams — once we error, no `reviews` row is written.
 */

export class StreamCapExceededError extends Error {
  readonly seq: number;
  constructor(seq: number) {
    super(`stream cap exceeded after ${String(seq)} chunks`);
    this.name = 'StreamCapExceededError';
    this.seq = seq;
  }
}

export interface ChunkBatcherDeps {
  supabase: SupabaseClient;
  jobId: string;
  /** Hard upper bound on chunks ever emitted for this job. */
  maxChunks?: number;
  /** Time-based flush, in milliseconds. Default 100. */
  flushIntervalMs?: number;
  /** Byte-based flush threshold (UTF-8). Default 256. */
  flushThresholdBytes?: number;
  /** Test seam: schedule a deferred flush. Defaults to setTimeout. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Test seam: replace the actual DB write. */
  insert?: (jobId: string, seq: number, content: string) => Promise<void>;
}

export interface ChunkBatcher {
  /**
   * Buffer a fragment. Synchronous — does **not** await the underlying
   * INSERT. Throws {@link StreamCapExceededError} if pushing this
   * fragment would take us past `maxChunks`.
   */
  onChunk(text: string): void;
  /**
   * Force-flush whatever is buffered. Awaits all pending writes,
   * including ones already in flight from a timer / threshold trigger.
   * Idempotent.
   */
  flush(): Promise<void>;
  /** Number of chunks already written or in-flight. Includes the buffered fragment when present. */
  getCount(): number;
}

const DEFAULT_MAX_CHUNKS = 5000;
const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_THRESHOLD_BYTES = 256;

export function createChunkBatcher(deps: ChunkBatcherDeps): ChunkBatcher {
  const maxChunks = deps.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const intervalMs = deps.flushIntervalMs ?? DEFAULT_INTERVAL_MS;
  const thresholdBytes = deps.flushThresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const insert =
    deps.insert ?? ((jobId, seq, content) => insertChunk(deps.supabase, jobId, seq, content));

  let buffer = '';
  let bufferBytes = 0;
  /** Number of chunks already promised to a `seq` (writing or written). */
  let nextSeq = 0;
  let timer: unknown = null;
  /** Latest in-flight write. Awaited by flush() so callers see the tail. */
  let inFlight: Promise<void> = Promise.resolve();

  function clearTimerIfAny(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function flushNow(): void {
    if (buffer.length === 0) return;
    const seq = nextSeq;
    nextSeq += 1;
    const content = buffer;
    buffer = '';
    bufferBytes = 0;
    clearTimerIfAny();

    // Chain so flush() awaits all in-flight writes, including any kicked
    // off before a previous one resolved. Errors propagate to flush().
    inFlight = inFlight.then(() => insert(deps.jobId, seq, content));
  }

  function scheduleFlush(): void {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      flushNow();
    }, intervalMs);
  }

  return {
    onChunk(text: string): void {
      if (text.length === 0) return;
      // Cap counts row inserts. Appending to an existing buffer doesn't
      // add a row; only starting a fresh row does. Refuse only when we
      // would have to allocate a brand-new seq beyond the cap.
      const startsNewRow = buffer.length === 0;
      if (startsNewRow && nextSeq >= maxChunks) {
        throw new StreamCapExceededError(nextSeq);
      }
      buffer += text;
      bufferBytes += Buffer.byteLength(text, 'utf-8');
      if (bufferBytes >= thresholdBytes) {
        flushNow();
      } else {
        scheduleFlush();
      }
    },
    async flush(): Promise<void> {
      flushNow();
      // Await whatever the chained promise resolves to. If any link
      // rejected, the error surfaces here.
      await inFlight;
    },
    getCount(): number {
      return nextSeq + (buffer.length > 0 ? 1 : 0);
    },
  };
}
