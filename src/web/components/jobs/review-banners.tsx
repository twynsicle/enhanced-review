import { Group } from '@mantine/core';
import { plural } from '@/common/plural';
import { RerunButton } from '@/web/components/jobs/rerun-button';
import { bannerStyle } from '@/web/theme/tokens';

/** Shown when the target has moved past the reviewed head; offers a rerun. */
export function StalenessBanner({ jobId, commitsAhead }: { jobId: string; commitsAhead: number }) {
  const label =
    commitsAhead === 0
      ? 'New commits since this review.'
      : `${plural(commitsAhead, 'new commit')} since this review.`;
  return (
    <Group
      role="status"
      justify="space-between"
      gap={12}
      px={16}
      py={12}
      fz="sm"
      style={bannerStyle('before')}
    >
      <span>{label}</span>
      <RerunButton jobId={jobId} variant="banner" />
    </Group>
  );
}
