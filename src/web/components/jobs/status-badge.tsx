import { Badge } from '@mantine/core';
import type { JobStatus } from '@/domain/jobs/status';
import { CAPTION_TYPE } from '@/web/theme/tokens';

const TONE: Record<JobStatus, string> = {
  pending: 'gray',
  running: 'iris',
  done: 'iris',
  error: 'risk',
  cancelled: 'gray',
};

/** Uppercase status pill used by every job list. */
export function StatusBadge({ status }: { status: JobStatus }) {
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
      {status}
    </Badge>
  );
}
