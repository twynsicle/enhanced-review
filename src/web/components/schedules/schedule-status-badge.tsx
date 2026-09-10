import { Badge } from '@mantine/core';
import type { ScheduleStatus } from '@/domain/schedules/schedule';
import { CAPTION_TYPE } from '@/web/theme/tokens';

/**
 * Uppercase status pill for a schedule, matching `jobs/status-badge.tsx`.
 * `running` shows as "starting": it is the moment a tick holds the claim, not
 * a phase the reader can watch, and calling it "running" beside a job list
 * that means something else by the word would read as the review itself.
 */
const TONE: Record<ScheduleStatus, string> = {
  active: 'iris',
  running: 'iris',
  paused: 'gray',
  failed: 'risk',
};

const LABEL: Record<ScheduleStatus, string> = {
  active: 'active',
  running: 'starting',
  paused: 'paused',
  failed: 'failed',
};

export function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  return (
    <Badge
      variant="light"
      color={TONE[status]}
      radius="xl"
      size="sm"
      fz={CAPTION_TYPE.size}
      fw={CAPTION_TYPE.weight}
      tt="uppercase"
      style={{ letterSpacing: CAPTION_TYPE.tracking }}
    >
      {LABEL[status]}
    </Badge>
  );
}
