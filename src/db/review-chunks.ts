import { prisma } from './client.ts';

/**
 * `review_chunks` repository: the executor's streamed text, one row per
 * fragment, keyed `(job_id, seq)` with `seq` starting at **0** (the PocketBase
 * era dropped chunk 0; see phase-0-plan). The live view polls
 * `listChunksAfter(jobId, lastSeenSeq)` (00-overview D5).
 */
export interface ReviewChunkRecord {
  seq: number;
  content: string;
  createdAt: Date;
}

export async function insertChunk(jobId: string, seq: number, content: string): Promise<void> {
  await prisma.reviewChunk.create({ data: { jobId, seq, content }, select: { seq: true } });
}

/** Chunks with `seq > afterSeq`, in order. `afterSeq = -1` returns them all. */
export function listChunksAfter(jobId: string, afterSeq = -1): Promise<ReviewChunkRecord[]> {
  return prisma.reviewChunk.findMany({
    where: { jobId, seq: { gt: afterSeq } },
    orderBy: { seq: 'asc' },
    select: { seq: true, content: true, createdAt: true },
  });
}
