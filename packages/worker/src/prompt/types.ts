/**
 * Worker-local PR-data shape consumed by the narrative prompt builder.
 *
 * Ported from the diffy POC's `PrData`/`PrFileChange` types but trimmed to
 * what the prompt actually reads. The worker assembles this from:
 *   - PR/branch metadata fetched via the github-client (title, refs, body)
 *   - The output of `git diff base..head` after the shallow clone
 *   - GitHub's "files changed" API response for status + additions/deletions
 */

export type PrFileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'unchanged';

export interface PrFileChange {
  filename: string;
  status: PrFileStatus;
  additions: number;
  deletions: number;
}

export interface PrData {
  title: string;
  body: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  files: PrFileChange[];
  diff: string;
}
