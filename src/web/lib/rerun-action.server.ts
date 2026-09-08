import { redirect, type RouterContextProvider } from 'react-router';
import { GithubAuthError } from '@/domain/github/client.server';
import { HeadShaResolutionError, JobInFlightError, JobNotFoundError } from '@/domain/jobs/errors';
import { rerunJob } from '@/domain/jobs/start-review.server';
import { userContext } from '@/web/auth/context.server';
import { actionError } from '@/web/lib/action-error';
import { relinkRedirect, requireGithubToken } from '@/web/lib/github.server';

/**
 * Shared by the `/jobs/:id` and `/reviews/:id` actions (`intent=rerun`):
 * rerun `sourceJobId` for the viewer and redirect to the new live page. Lives
 * in a `.server` module because a route file's extra exports are shipped to
 * the browser.
 */
export async function rerunAction(
  request: Request,
  context: Readonly<RouterContextProvider>,
  sourceJobId: string,
) {
  const user = context.get(userContext);
  if (!user) throw redirect('/login');
  const githubToken = await requireGithubToken(request);
  try {
    const { id } = await rerunJob({ userId: user.id, token: githubToken, sourceJobId });
    return redirect(`/jobs/${id}`);
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      return actionError('not_found', 'That review no longer exists.');
    }
    if (err instanceof JobInFlightError) {
      return actionError('job_in_flight', err.message, { activeJobId: err.activeJobId });
    }
    if (err instanceof GithubAuthError) throw await relinkRedirect();
    if (err instanceof HeadShaResolutionError) {
      return actionError('head_resolution_failed', 'Could not resolve the current head on GitHub.');
    }
    throw err;
  }
}
