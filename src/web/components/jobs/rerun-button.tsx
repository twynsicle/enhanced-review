import { Anchor, Button, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link, useFetcher } from 'react-router';
import { isActionError } from '@/web/lib/action-error';
import { token } from '@/web/theme/tokens';

/**
 * Posts `intent=rerun` to the job's route action; the action redirects to the
 * new job's live page and the fetcher follows. Two visual variants as on
 * `main`: the outline header button and the staleness-banner CTA.
 */
export function RerunButton({
  jobId,
  variant = 'header',
  children,
}: {
  jobId: string;
  variant?: 'header' | 'banner';
  children?: ReactNode;
}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  const error = isActionError(fetcher.data) ? fetcher.data : null;
  const onClick = () => {
    void fetcher.submit({ intent: 'rerun' }, { method: 'post', action: `/jobs/${jobId}` });
  };

  const errorNode = error ? (
    <Text component="span" fz="xs" c={token('destructive')}>
      {error.message}
      {error.reason === 'job_in_flight' && error.activeJobId && (
        <>
          {' '}
          <Anchor
            component={Link}
            to={`/jobs/${error.activeJobId}`}
            fz="xs"
            c="inherit"
            underline="always"
          >
            View it →
          </Anchor>
        </>
      )}
    </Text>
  ) : null;

  const button =
    variant === 'banner' ? (
      <Button
        variant="light"
        size="compact-sm"
        disabled={busy}
        onClick={onClick}
        aria-busy={busy}
        radius={4}
        fw={500}
      >
        {busy ? 'Re-running…' : (children ?? 'Re-run →')}
      </Button>
    ) : (
      <Button
        variant="default"
        size="sm"
        radius="xl"
        h={32}
        px={12}
        fz={13}
        disabled={busy}
        onClick={onClick}
        aria-busy={busy}
      >
        {busy ? 'Re-running…' : (children ?? 'Re-run')}
      </Button>
    );

  return (
    <Group gap={8} wrap="nowrap">
      {button}
      {errorNode}
    </Group>
  );
}
