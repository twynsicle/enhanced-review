import { Container, Stack, Text, Title } from '@mantine/core';
import { buildActivityBuckets } from '@/domain/jobs/activity';
import { listJobs, listRecentActivity, toJobView } from '@/domain/jobs/jobs.server';
import { RecentReviews } from '@/web/components/home/recent-reviews';
import { token } from '@/web/theme/tokens';
import type { Route } from './+types/home';

const RECENT_LIMIT = 5;

/** Home: hero + composer (commit 2) + the Recent card. */
export async function loader() {
  const [recent, activity] = await Promise.all([
    listJobs({ limit: RECENT_LIMIT }),
    listRecentActivity(),
  ]);
  return { recent: recent.map(toJobView), activity: buildActivityBuckets(activity) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <Container
      component="main"
      size={896}
      w="100%"
      px={{ base: 20, sm: 28 }}
      py={{ base: 48, sm: 56 }}
    >
      <Stack gap={48}>
        <Stack component="section" gap={24}>
          <Stack gap={8}>
            <Text
              fz={11}
              fw={500}
              tt="uppercase"
              c={token('before')}
              style={{ letterSpacing: '0.18em' }}
            >
              ❖&nbsp;&nbsp;A new review
            </Text>
            <Title
              order={1}
              fz={{ base: 36, sm: 44 }}
              fw={600}
              lh={1.05}
              style={{ letterSpacing: '-0.02em' }}
            >
              The reviewer is ready when you are.
            </Title>
            <Text maw="58ch" fz={15} lh={1.55} c="dimmed">
              Choose a pull request or branch — we’ll read every line, write the chapters, and
              surface the few things that genuinely need a human eye.
            </Text>
          </Stack>
        </Stack>
        <RecentReviews jobs={loaderData.recent} activity={loaderData.activity} />
      </Stack>
    </Container>
  );
}
