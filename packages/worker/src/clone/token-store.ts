import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../log';

/**
 * Service-role-only helpers for the per-job encrypted GitHub token. The
 * SQL functions are exposed only to service_role (see migration 0003),
 * so all calls here go through the worker's admin client.
 *
 * Token lifecycle:
 *   1. /api/jobs encrypts the token at submit time via
 *      `create_review_job_with_token`.
 *   2. Worker calls `claimGithubToken` after winning the row.
 *   3. After clone returns (success or failure), worker calls
 *      `clearGithubToken` to NULL the column. The token is then
 *      unrecoverable even if the row outlives the job.
 */

export class TokenMissingError extends Error {
  constructor(jobId: string) {
    super(`No encrypted GitHub token found for job ${jobId}`);
    this.name = 'TokenMissingError';
  }
}

export async function claimGithubToken(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('decrypt_review_job_token', {
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`decrypt_review_job_token(${jobId}) failed: ${error.message}`);
  }
  if (typeof data !== 'string' || data.length === 0) {
    throw new TokenMissingError(jobId);
  }
  return data;
}

export async function clearGithubToken(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from('review_jobs')
    .update({ github_token_encrypted: null })
    .eq('id', jobId);
  if (error) {
    // Best effort. The token will expire naturally if the GH OAuth flow
    // is re-run; an operator can also UPDATE … set github_token_encrypted
    // = null manually if cleanup repeatedly fails.
    logger.error({ job_id: jobId, err: error.message }, 'clearGithubToken failed');
  }
}
