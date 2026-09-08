import { Anchor, Container, Stack, Text, Title } from '@mantine/core';
import { data, isRouteErrorResponse, Link, redirect, useRouteLoaderData } from 'react-router';
import { z } from 'zod';
import { cancelJob } from '@/domain/jobs/cancel-job.server';
import { getJob, listChunksAfter, toJobView } from '@/domain/jobs/jobs.server';
import { userContext } from '@/web/auth/context.server';
import { AppError } from '@/web/components/app-error';
import { JobLiveView } from '@/web/components/jobs/job-live-view';
import { actionError } from '@/web/lib/action-error';
import { parseFormData, parseParams } from '@/web/lib/parse.server';
import { rerunAction } from '@/web/lib/rerun-action.server';
import { token } from '@/web/theme/tokens';
import type { loader as shellLoader } from './_shell';
import type { Route } from './+types/jobs.$id';

const ParamsSchema = z.object({ id: z.string().min(1) });
const IntentSchema = z.object({ intent: z.enum(['cancel', 'rerun']) });

export const meta: Route.MetaFunction = () => [{ title: 'Review in progress · enhanced-review' }];

/**
 * `/jobs/:id` — live view of one review job. Any signed-in beta member can
 * watch any job (workspace visibility, as on `main`); only the owner can
 * cancel it. Unknown ids throw 404 into this route's ErrorBoundary.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { id } = parseParams(ParamsSchema, params);
  const job = await getJob(id);
  if (!job) throw data(null, { status: 404 });
  const chunks = await listChunksAfter(id);
  return { job: toJobView(job), chunks, viewerUserId: context.get(userContext)?.id ?? '' };
}

/** `intent=cancel` (owner only) or `intent=rerun` (phase-4-plan §2). */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { id } = parseParams(ParamsSchema, params);
  const { intent } = await parseFormData(IntentSchema, request);
  const user = context.get(userContext);
  if (!user) throw redirect('/login');
  if (intent === 'rerun') return rerunAction(request, context, id);
  const outcome = await cancelJob({ jobId: id, userId: user.id });
  if (outcome === 'not-cancellable') {
    return actionError('not_cancellable', 'This review can no longer be cancelled.');
  }
  return { ok: true as const };
}

export default function JobPage({ loaderData }: Route.ComponentProps) {
  const shell = useRouteLoaderData<typeof shellLoader>('routes/_shell');
  const liveMs = shell?.polling.liveMs ?? 2000;
  return (
    <Container component="main" size={768} w="100%" px={28} py={48}>
      <Stack gap={40}>
        <JobLiveView
          key={loaderData.job.id}
          initialJob={loaderData.job}
          initialChunks={loaderData.chunks}
          viewerUserId={loaderData.viewerUserId}
          liveMs={liveMs}
        />
      </Stack>
    </Container>
  );
}

/** 404 renders the legacy "Review not found" page; anything else defers to the root boundary. */
export function ErrorBoundary(props: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(props.error) && props.error.status === 404) return <JobNotFound />;
  return <AppError error={props.error} />;
}

export function JobNotFound() {
  return (
    <Container component="main" size={576} w="100%" px={24} py={64}>
      <Stack align="center" gap={24} ta="center">
        <Title order={1} fz={20} fw={600} ff="text">
          Review not found
        </Title>
        <Text fz="sm" c="dimmed">
          This review id doesn’t match any job we know about. It may have been deleted, or the link
          may be wrong.
        </Text>
        <Anchor component={Link} to="/history" fz="sm" fw={500} c={token('primary')}>
          Back to review history →
        </Anchor>
      </Stack>
    </Container>
  );
}
