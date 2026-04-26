import type { SupabaseClient } from '@supabase/supabase-js';
import type { NarrativeReview } from '@enhanced-review/review-types';
import { logger } from './log';

/**
 * Service-role writes that produce content the page subscribes to via
 * Realtime. Kept here so the stub job (and Phase 4's real executor)
 * share a single way to publish output.
 */

export async function insertChunk(
  supabase: SupabaseClient,
  jobId: string,
  seq: number,
  content: string,
): Promise<void> {
  const { error } = await supabase.from('review_chunks').insert({
    job_id: jobId,
    seq,
    content,
  });
  if (error) {
    throw new Error(`insertChunk(${jobId}, seq=${seq}) failed: ${error.message}`);
  }
}

export async function finalizeAsDone(
  supabase: SupabaseClient,
  jobId: string,
  content: NarrativeReview,
  options: { diffTruncated?: boolean } = {},
): Promise<void> {
  // Insert the review row first so a subscriber that observes status='done'
  // is guaranteed to find the corresponding reviews row.
  const { error: insertError } = await supabase.from('reviews').insert({
    job_id: jobId,
    content,
    diff_truncated: options.diffTruncated ?? false,
  });
  if (insertError) {
    throw new Error(`finalize(${jobId}) reviews insert failed: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from('review_jobs')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', jobId);
  if (updateError) {
    throw new Error(`finalize(${jobId}) status update failed: ${updateError.message}`);
  }
}

export async function markErrored(
  supabase: SupabaseClient,
  jobId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from('review_jobs')
    .update({
      status: 'error',
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 500),
    })
    .eq('id', jobId);
  if (error) {
    // Best-effort: log and move on. The next worker boot's recovery sweep
    // marks stuck `running` rows as errored even if this update never lands.
    logger.error({ job_id: jobId, err: error.message }, 'markErrored failed');
  }
}
