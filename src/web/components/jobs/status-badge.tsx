import { Badge } from '@mantine/core';
import type { JobStatus } from '@/domain/jobs/status';

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
      fw={500}
      style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}
    >
      {status}
    </Badge>
  );
}
