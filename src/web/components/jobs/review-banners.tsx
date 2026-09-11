import { Box, Group, Text } from '@mantine/core';
import { RerunButton } from '@/web/components/jobs/rerun-button';
import { token, type TokenName } from '@/web/theme/tokens';

function bannerStyle(tone: TokenName) {
  return {
    borderRadius: 6,
    border: `1px solid color-mix(in oklab, ${token(tone)} 40%, transparent)`,
    background: `color-mix(in oklab, ${token(tone)} 10%, transparent)`,
    color: token('foreground'),
  };
}

/** Shown when the runner clipped the diff to fit the prompt budget. */
export function TruncationBanner() {
  return (
    <Box role="status" px={16} py={12} fz="sm" style={bannerStyle('suggestion')}>
      <Text component="strong" fz="inherit" fw={600}>
        Diff was truncated
      </Text>{' '}
      to fit the token budget — some files may not be included in this review.
    </Box>
  );
}

/** Shown when the target has moved past the reviewed head; offers a rerun. */
export function StalenessBanner({ jobId, commitsAhead }: { jobId: string; commitsAhead: number }) {
  const label =
    commitsAhead === 0
      ? 'New commits since this review.'
      : `${commitsAhead} new commit${commitsAhead === 1 ? '' : 's'} since this review.`;
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
