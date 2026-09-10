import { Anchor, Box, Button, Group, Stack, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { Link, useFetcher } from 'react-router';
import { timeAgo, timeUntil } from '@/common/time-ago';
import { describeTarget } from '@/domain/review/target';
import { describeCadence, isOwnerActionable, type ScheduleView } from '@/domain/schedules/schedule';
import { isActionError } from '@/web/lib/action-error';
import { token } from '@/web/theme/tokens';
import { ScheduleStatusBadge } from './schedule-status-badge';

/**
 * One schedule: what it reviews, how often, when it next fires, and the two
 * controls the owner has over it. Every control is a form post to the
 * `/schedules` action, so the row works without JavaScript and the list
 * revalidates itself afterwards.
 *
 * The list only ever holds the viewer's own schedules, so there is no
 * "someone else's" state to render — but `running` still hides the controls,
 * because a schedule a tick has claimed is mid-launch and cannot be moved.
 */
export function ScheduleRow({
  schedule,
  first,
  now,
}: {
  schedule: ScheduleView;
  first: boolean;
  /** The loader's clock, so SSR and hydration word the countdown the same. */
  now: string;
}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  const failure = isActionError(fetcher.data) ? fetcher.data.message : null;
  const actionable = isOwnerActionable(schedule.status);
  const paused = schedule.status === 'paused';

  return (
    <Box py={16} style={{ borderTop: first ? undefined : `1px solid ${token('border')}` }}>
      <Group justify="space-between" align="flex-start" gap={16} wrap="nowrap">
        <Stack gap={4} miw={0} style={{ flex: 1 }}>
          <Text fz="md" fw={500} truncate>
            {describeTarget(schedule.target)}
          </Text>
          <Text fz="sm" c="dimmed" truncate>
            {describeCadence(schedule.cadence, schedule.hourOfDay, schedule.timeZone)} ·{' '}
            {paused ? 'paused' : `next ${timeUntil(schedule.nextRunAt, new Date(now).getTime())}`}
            {schedule.lastRunAt ? ` · last run ${timeAgo(schedule.lastRunAt)}` : ' · never run'}
          </Text>
          {schedule.lastJobId && (
            <Anchor
              component={Link}
              to={`/jobs/${schedule.lastJobId}`}
              fz="sm"
              c={token('foreground')}
            >
              Open the last run →
            </Anchor>
          )}
          {schedule.lastError && (
            <Text role="alert" fz="sm" c={token('destructive')}>
              {schedule.consecutiveFailures} failed{' '}
              {schedule.consecutiveFailures === 1 ? 'attempt' : 'attempts'}: {schedule.lastError}
            </Text>
          )}
          {failure && (
            <Text role="alert" fz="sm" c={token('destructive')}>
              {failure}
            </Text>
          )}
        </Stack>

        <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
          <ScheduleStatusBadge status={schedule.status} />
          {actionable && (
            <fetcher.Form method="post" action="/schedules">
              <input type="hidden" name="scheduleId" value={schedule.id} />
              <Group gap={4} wrap="nowrap">
                <Button
                  type="submit"
                  name="intent"
                  value={paused ? 'resume' : 'pause'}
                  disabled={busy}
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={
                    paused ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />
                  }
                >
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="delete"
                  disabled={busy}
                  variant="subtle"
                  color="risk"
                  size="compact-sm"
                  aria-label={`Delete schedule for ${describeTarget(schedule.target)}`}
                >
                  <IconTrash size={14} />
                </Button>
              </Group>
            </fetcher.Form>
          )}
        </Group>
      </Group>
    </Box>
  );
}
