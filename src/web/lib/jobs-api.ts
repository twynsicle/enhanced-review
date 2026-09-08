import type { ChunkView, JobView } from '@/domain/jobs/job-view';

/**
 * Body of `GET /api/jobs/:id?after=<seq>`: the job row plus the chunks
 * streamed after `after`. The live view polls this with the highest `seq` it
 * has seen; `after=-1` returns every chunk.
 */
export interface JobPollResponse {
  job: JobView;
  chunks: ChunkView[];
}

export function isJobPollResponse(value: unknown): value is JobPollResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as { job?: unknown; chunks?: unknown };
  return typeof body.job === 'object' && body.job !== null && Array.isArray(body.chunks);
}

/**
 * Body of `GET /api/me/jobs/terminal?since=<iso>`: the viewer's jobs that
 * reached a terminal status at or after `since`, plus the server clock to use
 * as the next `since`.
 */
export interface TerminalJobsResponse {
  now: string;
  jobs: JobView[];
}

export function isTerminalJobsResponse(value: unknown): value is TerminalJobsResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as { now?: unknown; jobs?: unknown };
  return typeof body.now === 'string' && Array.isArray(body.jobs);
}

/** Append `incoming` to `chunks`, de-duplicated and ordered by `seq`. */
export function mergeChunks(chunks: ChunkView[], incoming: ChunkView[]): ChunkView[] {
  if (incoming.length === 0) return chunks;
  const bySeq = new Map(chunks.map((chunk) => [chunk.seq, chunk]));
  for (const chunk of incoming) bySeq.set(chunk.seq, chunk);
  return [...bySeq.values()].toSorted((a, b) => a.seq - b.seq);
}

export function lastSeq(chunks: ChunkView[]): number {
  return chunks.length === 0 ? -1 : (chunks.at(-1)?.seq ?? -1);
}
