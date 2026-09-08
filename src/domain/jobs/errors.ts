/**
 * Failures the job service reports to its callers. Phase 4 maps them to
 * HTTP: in-flight → 409, not found → 404, head-SHA resolution → 502
 * (a GitHub auth failure is `GithubAuthError` and goes to `/relink`).
 * Shared with the browser only as types; nothing here touches Node.
 */
export class JobInFlightError extends Error {
  readonly activeJobId: string;
  constructor(activeJobId: string) {
    super('You already have a review in progress. Wait for it to finish or cancel it.');
    this.name = 'JobInFlightError';
    this.activeJobId = activeJobId;
  }
}

export class JobNotFoundError extends Error {
  readonly jobId: string;
  constructor(jobId: string) {
    super(`job not found: ${jobId}`);
    this.name = 'JobNotFoundError';
    this.jobId = jobId;
  }
}

export class HeadShaResolutionError extends Error {
  constructor(cause: unknown) {
    super('failed to resolve the current head SHA from GitHub', { cause });
    this.name = 'HeadShaResolutionError';
  }
}
