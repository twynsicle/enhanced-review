import { Anchor, Box, Code, Container, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { z } from 'zod';
import { listJobs, toJobView } from '@/domain/jobs/jobs.server';
import { JOB_STATUSES } from '@/domain/jobs/status';
import { EmptyLibrary } from '@/web/components/history/empty-library';
import { FilterChips, type StatusFilter } from '@/web/components/history/filter-chips';
import { JobListRow } from '@/web/components/jobs/job-list-row';
import { parseSearchParams } from '@/web/lib/parse.server';
import { token } from '@/web/theme/tokens';
import type { Route } from './+types/history';

const PAGE_SIZE = 100;

/** Unknown statuses fall back to "all" rather than 400. */
const SearchSchema = z.object({
  status: z.enum(JOB_STATUSES).optional().catch(undefined),
});

export const meta: Route.MetaFunction = () => [{ title: 'Library — enhanced-review' }];

/** Workspace-wide list: every beta member's jobs, newest first. */
export async function loader({ request }: Route.LoaderArgs) {
  const { status } = parseSearchParams(SearchSchema, request);
  const jobs = (await listJobs({ status, limit: PAGE_SIZE })).map(toJobView);
  return { status: (status ?? 'all') as StatusFilter, jobs };
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { status, jobs } = loaderData;
  const isEmpty = jobs.length === 0 && status === 'all';

  return (
    <Container component="main" size={896} w="100%" px={28} py={48}>
      {isEmpty ? (
        <EmptyLibrary />
      ) : (
        <Stack gap={32}>
          <Stack component="header" gap={8}>
            <Text
              fz={11}
              fw={500}
              tt="uppercase"
              c={token('before')}
              style={{ letterSpacing: '0.18em' }}
            >
              ❖&nbsp;&nbsp;Library
            </Text>
            <Title order={1} fz={30} fw={600} style={{ letterSpacing: '-0.015em' }}>
              Every review, indexed.
            </Title>
          </Stack>

          <FilterChips current={status} />

          {jobs.length === 0 ? (
            <Text
              p={32}
              ta="center"
              fz="sm"
              c="dimmed"
              style={{
                borderRadius: 12,
                border: `1px solid ${token('border')}`,
                background: token('card'),
              }}
            >
              No reviews with status <Code>{status}</Code>.{' '}
              <Anchor component={Link} to="/history" fw={500} c={token('foreground')}>
                Show all →
              </Anchor>
            </Text>
          ) : (
            <Box component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
              {jobs.map((job, i) => (
                <li key={job.id}>
                  <JobListRow job={job} first={i === 0} variant="history" />
                </li>
              ))}
            </Box>
          )}
        </Stack>
      )}
    </Container>
  );
}
