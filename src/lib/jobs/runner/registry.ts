import 'server-only';

/**
 * In-process AbortController registry for running review jobs.
 * The POST /api/jobs route registers a controller before firing the runner;
 * the POST /api/jobs/[id]/cancel route signals it to abort the in-flight job.
 *
 * Safe for the ~5 concurrent jobs this app targets: all requests share the
 * same Node.js process (Next.js server on Fargate, or `next dev` locally).
 */

const controllers = new Map<string, AbortController>();

export function register(jobId: string, controller: AbortController): void {
  controllers.set(jobId, controller);
}

export function signal(jobId: string): boolean {
  const controller = controllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function unregister(jobId: string): void {
  controllers.delete(jobId);
}

/**
 * Iterate registered controllers. Used by the SIGTERM handler to abort
 * every in-flight job at shutdown.
 */
export function entries(): IterableIterator<[string, AbortController]> {
  return controllers.entries();
}
