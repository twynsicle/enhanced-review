import { Box, Stack, Text, Title } from '@mantine/core';
import { redirect } from 'react-router';
import { z } from 'zod';
import { isValidTimeZone } from '@/domain/schedules/cadence';
import { DuplicateScheduleError, ScheduleLimitError } from '@/domain/schedules/errors';
import { SCHEDULE_CADENCES } from '@/domain/schedules/schedule';
import {
  createSchedule,
  deleteSchedule,
  listSchedulesForUser,
  pauseSchedule,
  resumeSchedule,
  toScheduleView,
} from '@/domain/schedules/schedules.server';
import { ReviewTargetSchema } from '@/domain/review/target';
import { userContext } from '@/web/auth/context.server';
import { Caption } from '@/web/components/caption';
import { PageShell } from '@/web/components/page-shell';
import { EmptySchedules } from '@/web/components/schedules/empty-schedules';
import { ScheduleRow } from '@/web/components/schedules/schedule-row';
import { actionError } from '@/web/lib/action-error';
import { parseFormData } from '@/web/lib/parse.server';
import { DISPLAY_SIZE, token } from '@/web/theme/tokens';
import type { Route } from './+types/schedules';

/** The composer posts the target as one JSON field, as the create action does. */
const TargetField = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'target is not valid JSON' });
      return z.NEVER;
    }
  })
  .pipe(ReviewTargetSchema);

const CreateSchema = z.object({
  intent: z.literal('create'),
  target: TargetField,
  cadence: z.enum(SCHEDULE_CADENCES),
  // The browser sends its own zone; an unknown one is a 400 rather than a
  // schedule that can never resolve an hour.
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone, 'unknown time zone'),
  hourOfDay: z.coerce.number().int().min(0).max(23),
});

const ScheduleIdField = z.string().min(1);

const ActionSchema = z.discriminatedUnion('intent', [
  CreateSchema,
  z.object({ intent: z.literal('pause'), scheduleId: ScheduleIdField }),
  z.object({ intent: z.literal('resume'), scheduleId: ScheduleIdField }),
  z.object({ intent: z.literal('delete'), scheduleId: ScheduleIdField }),
]);

export const meta: Route.MetaFunction = () => [{ title: 'Schedules — enhanced-review' }];

/**
 * `/schedules` — the viewer's standing instructions.
 *
 * Unlike `/history`, this list is *yours*: a schedule spends the owner's job
 * budget and only the owner can change it, so showing everyone else's would
 * be a list of things you cannot act on.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  if (!user) throw redirect('/login');
  const schedules = await listSchedulesForUser(user.id);
  return { schedules: schedules.map(toScheduleView), serverNow: new Date().toISOString() };
}

/**
 * `intent=create` (from the home composer) or one of the owner actions.
 * Pause and resume carry the viewer through to the repository, where the
 * `user_id` in the conditional update is the authorisation check.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);
  if (!user) throw redirect('/login');
  const form = await parseFormData(ActionSchema, request);

  if (form.intent === 'create') {
    try {
      await createSchedule({
        userId: user.id,
        target: form.target,
        cadence: form.cadence,
        timeZone: form.timeZone,
        hourOfDay: form.hourOfDay,
      });
    } catch (err) {
      if (err instanceof ScheduleLimitError) return actionError('schedule_limit', err.message);
      if (err instanceof DuplicateScheduleError) {
        return actionError('duplicate_schedule', err.message);
      }
      throw err;
    }
    return redirect('/schedules');
  }

  if (form.intent === 'pause') {
    const outcome = await pauseSchedule({ scheduleId: form.scheduleId, userId: user.id });
    if (outcome === 'not-pausable') {
      return actionError('not_schedulable', 'This schedule can no longer be paused.');
    }
    return { ok: true as const };
  }

  if (form.intent === 'resume') {
    const outcome = await resumeSchedule({ scheduleId: form.scheduleId, userId: user.id });
    if (outcome === 'not-resumable') {
      return actionError('not_schedulable', 'This schedule can no longer be resumed.');
    }
    return { ok: true as const };
  }

  const outcome = await deleteSchedule({ scheduleId: form.scheduleId, userId: user.id });
  if (outcome === 'not-found') {
    return actionError('not_found', 'That schedule no longer exists.');
  }
  return { ok: true as const };
}

export default function Schedules({ loaderData }: Route.ComponentProps) {
  const { schedules, serverNow } = loaderData;

  return (
    <PageShell>
      {schedules.length === 0 ? (
        <EmptySchedules />
      ) : (
        <Stack gap={32}>
          <Stack component="header" gap={8}>
            <Caption tone="before">◷&nbsp;&nbsp;Schedules</Caption>
            <Title order={1} fz={DISPLAY_SIZE} fw={600} style={{ letterSpacing: '-0.02em' }}>
              Reviews that run themselves.
            </Title>
            <Text maw="58ch" fz="md" c="dimmed">
              Each one starts a review on your behalf and counts against the same in-flight limit as
              a review you start by hand. A run that cannot start retries; one that keeps failing is
              parked here for you to look at.
            </Text>
          </Stack>

          <Box component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
            {schedules.map((schedule, i) => (
              <li key={schedule.id}>
                <ScheduleRow schedule={schedule} first={i === 0} now={serverNow} />
              </li>
            ))}
          </Box>

          <Text fz="sm" c={token('muted-foreground')}>
            Schedules are armed from the composer on the home page.
          </Text>
        </Stack>
      )}
    </PageShell>
  );
}
