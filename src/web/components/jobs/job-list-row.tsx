import { Box, Group, NavLink, Text } from '@mantine/core';
import { Link } from 'react-router';
import { timeAgo } from '@/common/time-ago';
import { jobHref, type JobView } from '@/domain/jobs/job-view';
import { describeTarget } from '@/domain/review/target';
import { RiskScorePill } from '@/web/components/narrative/risk-score';
import { token } from '@/web/theme/tokens';
import { StatusBadge } from './status-badge';

function describeStatus(status: JobView['status']): string {
  if (status === 'running' || status === 'pending') return 'in progress';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'error') return 'errored';
  return '';
}

/**
 * One row of a job list: avatar · title + sub-line · risk pill · status.
 * `history` rows title the whole target; `recent` rows title the PR or branch
 * and put the repo in the sub-line.
 */
export function JobListRow({
  job,
  first,
  variant,
}: {
  job: JobView;
  first: boolean;
  variant: 'history' | 'recent';
}) {
  const target = job.target;
  const sha = job.headSha?.slice(0, 7) ?? '';
  const title =
    variant === 'history'
      ? describeTarget(target)
      : target.kind === 'pr'
        ? target.title
        : target.ref;
  const sub =
    variant === 'history'
      ? `@${job.githubLogin} · ${timeAgo(job.createdAt)} · ${sha}`
      : `${target.owner}/${target.repo} · @${job.githubLogin} · ${sha} · ${timeAgo(job.createdAt)}`;

  return (
    <NavLink
      component={Link}
      to={jobHref(job)}
      px={0}
      py={12}
      style={{ borderTop: first ? undefined : `1px solid ${token('border')}` }}
      leftSection={
        <img
          src={`https://github.com/${job.githubLogin}.png?size=64`}
          alt=""
          width={26}
          height={26}
          loading="lazy"
          style={{ width: 26, height: 26, borderRadius: '50%', display: 'block' }}
        />
      }
      label={
        <Text fz="md" fw={500} truncate>
          {title}
        </Text>
      }
      description={
        <Text fz="sm" c="dimmed" truncate>
          {sub}
        </Text>
      }
      rightSection={
        <Group gap={16} wrap="nowrap">
          {job.status === 'done' ? (
            <RiskScorePill score={job.riskScore} showLabel={false} />
          ) : (
            <Box component="span" visibleFrom="sm" ff="monospace" fz="xs" c="dimmed">
              {variant === 'recent' ? describeStatus(job.status) : ''}
            </Box>
          )}
          <StatusBadge status={job.status} />
        </Group>
      }
    />
  );
}
