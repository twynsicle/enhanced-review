import { Box, Group, Stack, Text, Title } from '@mantine/core';
import type { JobView } from '@/domain/jobs/job-view';
import { JobListRow } from '@/web/components/jobs/job-list-row';
import { token } from '@/web/theme/tokens';
import { Sparkline } from './sparkline';

/** Home page "Recent" card: the newest five jobs plus a 14-day sparkline. */
export function RecentReviews({ jobs, activity }: { jobs: JobView[]; activity: number[] }) {
  return (
    <Stack component="section" aria-label="Recent reviews" gap={16}>
      <Group justify="space-between" align="baseline" gap={12}>
        <Title order={2} fz={20} fw={600} style={{ letterSpacing: '-0.01em' }}>
          Recent
        </Title>
        <Group gap={8} wrap="nowrap" fz={11.5} c="dimmed">
          <Sparkline
            data={activity}
            color={token('before')}
            width={64}
            height={20}
            fill
            ariaLabel="Past 14 days of review activity"
          />
          <span>past 14 days</span>
        </Group>
      </Group>
      {jobs.length === 0 ? (
        <Text
          p={24}
          ta="center"
          fz="sm"
          c="dimmed"
          style={{
            borderRadius: 12,
            border: `1px solid ${token('border')}`,
            background: token('card'),
          }}
        >
          No reviews yet — pick a target above and start your first one.
        </Text>
      ) : (
        <Box component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
          {jobs.map((job, i) => (
            <li key={job.id}>
              <JobListRow job={job} first={i === 0} variant="recent" />
            </li>
          ))}
        </Box>
      )}
    </Stack>
  );
}
