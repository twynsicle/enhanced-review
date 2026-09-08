/**
 * Map a `review_jobs.error_message` to a one-line "what now" suggestion for
 * the live view's error box (ported verbatim from `main`).
 */
export function whatNowFor(errorMessage: string): string {
  const m = errorMessage.toLowerCase();
  if (m.startsWith('timeout')) {
    return 'The review hit the time limit. Try Re-run; if it keeps timing out, narrow the diff scope.';
  }
  if (m.startsWith('token')) {
    return 'GitHub token issue — re-link your account from the home page, then Re-run.';
  }
  if (m.startsWith('clone') && m.includes('mismatch')) {
    return 'The PR moved since the review started. Click Re-run to pick up the latest commits.';
  }
  if (m.startsWith('clone') || m.startsWith('git')) {
    return 'Clone failed — check the repo permissions on GitHub, then Re-run.';
  }
  if (m.startsWith('github')) {
    return 'GitHub API error. Try again in a minute, or check repo access.';
  }
  if (m.startsWith('stream cap exceeded')) {
    return 'The review output exceeded the streaming cap. The diff may be too large; try a smaller scope.';
  }
  if (m.startsWith('parse') || m.startsWith('executor')) {
    return 'The reviewer model returned unparseable output. Re-run usually clears it; if not, contact the operator.';
  }
  return 'Click Re-run to try again, or contact the operator if it persists.';
}
