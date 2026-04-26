import 'server-only';
import type { NarrativeReview } from '@enhanced-review/review-types';
import type PocketBase from 'pocketbase';
import { logger } from '@/lib/log';

export async function markRunning(pb: PocketBase, jobId: string): Promise<void> {
  await pb.collection('review_jobs').update(jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });
}

export async function insertChunk(
  pb: PocketBase,
  jobId: string,
  seq: number,
  content: string,
): Promise<void> {
  await pb.collection('review_chunks').create({ job: jobId, seq, content });
}

export async function finalizeAsDone(
  pb: PocketBase,
  jobId: string,
  content: NarrativeReview,
  options: { diffTruncated?: boolean } = {},
): Promise<void> {
  // Insert review row first so a subscriber observing status='done' already finds it.
  await pb.collection('reviews').create({
    job: jobId,
    content,
    diff_truncated: options.diffTruncated ?? false,
  });
  await pb.collection('review_jobs').update(jobId, {
    status: 'done',
    completed_at: new Date().toISOString(),
  });
}

export async function markErrored(pb: PocketBase, jobId: string, message: string): Promise<void> {
  try {
    await pb.collection('review_jobs').update(jobId, {
      status: 'error',
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 500),
    });
  } catch (err) {
    logger.error({ job_id: jobId, err }, 'markErrored failed');
  }
}
