import { Container, Stack, Text, Title } from '@mantine/core';
import { redirect } from 'react-router';
import { z } from 'zod';
import { GithubAuthError } from '@/domain/github/client.server';
import { buildActivityBuckets } from '@/domain/jobs/activity';
import { HeadShaResolutionError, JobInFlightError } from '@/domain/jobs/errors';
import { listJobs, listRecentActivity, toJobView } from '@/domain/jobs/jobs.server';
import { startReview } from '@/domain/jobs/start-review.server';
import { ReviewTargetSchema } from '@/domain/review/target';
import { userContext } from '@/web/auth/context.server';
import { RecentReviews } from '@/web/components/home/recent-reviews';
import { ReviewComposer } from '@/web/components/home/review-composer';
import { actionError } from '@/web/lib/action-error';
import { relinkRedirect, requireGithubToken } from '@/web/lib/github.server';
import { parseFormData } from '@/web/lib/parse.server';
import { token } from '@/web/theme/tokens';
import type { Route } from './+types/home';

const RECENT_LIMIT = 5;

/** The composer posts the target as one JSON field. */
const CreateSchema = z.object({
  target: z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'target is not valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(ReviewTargetSchema),
});

/** Home: hero + composer + the Recent card. */
export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  const [recent, activity] = await Promise.all([
    listJobs({ limit: RECENT_LIMIT }),
    listRecentActivity(),
  ]);
  return {
    userId: user?.id ?? '',
    recent: recent.map(toJobView),
    activity: buildActivityBuckets(activity),
  };
}

/**
 * POST / — start a review. Success redirects to the live view; a job already
 * in flight is a 409 naming it; a rejected GitHub token goes through /relink.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);
  if (!user) throw redirect('/login');
  const { target } = await parseFormData(CreateSchema, request);
  const githubToken = await requireGithubToken(request);
  try {
    const { id } = await startReview({ userId: user.id, token: githubToken, target });
    return redirect(`/jobs/${id}`);
  } catch (err) {
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

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <Container
      component="main"
      size={896}
      w="100%"
      px={{ base: 20, sm: 28 }}
      py={{ base: 48, sm: 56 }}
    >
      <Stack gap={48}>
        <Stack component="section" gap={24}>
          <Stack gap={8}>
            <Text
              fz={11}
              fw={500}
              tt="uppercase"
              c={token('before')}
              style={{ letterSpacing: '0.18em' }}
            >
              ❖&nbsp;&nbsp;A new review
            </Text>
            <Title
              order={1}
              fz={{ base: 36, sm: 44 }}
              fw={600}
              lh={1.05}
              style={{ letterSpacing: '-0.02em' }}
            >
              The reviewer is ready when you are.
            </Title>
            <Text maw="58ch" fz={15} lh={1.55} c="dimmed">
              Choose a pull request or branch — we’ll read every line, write the chapters, and
              surface the few things that genuinely need a human eye.
            </Text>
          </Stack>
          <ReviewComposer userId={loaderData.userId} />
        </Stack>
        <RecentReviews jobs={loaderData.recent} activity={loaderData.activity} />
      </Stack>
    </Container>
  );
}
