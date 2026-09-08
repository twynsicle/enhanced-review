import { Box, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useFetcher, useNavigate } from 'react-router';
import type { ChunkView, JobView } from '@/domain/jobs/job-view';
import { isTerminalStatus } from '@/domain/jobs/status';
import { extractChapterTitles } from '@/domain/review/partial-narrative-parse';
import { describeTarget } from '@/domain/review/target';
import { JobTimeline } from '@/web/components/jobs/job-timeline';
import { derivePhases, phaseEyebrow, phaseHeading } from '@/web/components/jobs/live-phases';
import { RerunButton } from '@/web/components/jobs/rerun-button';
import { whatNowFor } from '@/web/components/jobs/what-now';
import { isActionError } from '@/web/lib/action-error';
import { isJobPollResponse, lastSeq, mergeChunks } from '@/web/lib/jobs-api';
import { usePolling } from '@/web/lib/use-polling';
import { token } from '@/web/theme/tokens';

/**
 * Live view of one review job as a typographic timeline. Seeded by the
 * loader, then polled at `liveMs` through `/api/jobs/:id` with `after` = the
 * highest `seq` seen while the job is in flight. On the transition to a
 * terminal status the view refetches every chunk once (a single terminal
 * refresh) and, for `done` observed live, replaces itself with the reader.
 * Mount with `key={job.id}` so a rerun's redirect starts fresh state.
 */
export function JobLiveView({
  initialJob,
  initialChunks,
  viewerUserId,
  liveMs,
}: {
  initialJob: JobView;
  initialChunks: ChunkView[];
  viewerUserId: string;
  liveMs: number;
}) {
  const navigate = useNavigate();
  const [job, setJob] = useState(initialJob);
  const [chunks, setChunks] = useState(initialChunks);
  const chunksRef = useRef(initialChunks);
  const inFlightRequest = useRef<Promise<void> | null>(null);

  const poll = useCallback(
    async (after: number): Promise<JobView | null> => {
      const res = await fetch(`/api/jobs/${initialJob.id}?after=${String(after)}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const body: unknown = await res.json().catch(() => null);
      if (!isJobPollResponse(body)) return null;
      const merged = after === -1 ? body.chunks : mergeChunks(chunksRef.current, body.chunks);
      chunksRef.current = merged;
      setChunks(merged);
      setJob(body.job);
      return body.job;
    },
    [initialJob.id],
  );

  const tick = useCallback(() => {
    if (inFlightRequest.current) return;
    inFlightRequest.current = (async () => {
      try {
        const latest = await poll(lastSeq(chunksRef.current));
        if (!latest || !isTerminalStatus(latest.status)) return;
        await poll(-1);
        if (latest.status === 'done') {
          await navigate(`/reviews/${latest.id}`, { replace: true });
        }
      } catch {
        // Network blips are covered by the next tick.
      } finally {
        inFlightRequest.current = null;
      }
    })();
  }, [poll, navigate]);

  usePolling({ enabled: !isTerminalStatus(job.status), intervalMs: liveMs, tick });

  const cancel = useFetcher();
  const cancelling = cancel.state !== 'idle';
  const cancelError = isActionError(cancel.data) ? cancel.data.message : null;
  const cancellable = job.status === 'pending' || job.status === 'running';
  const isOwner = job.userId === viewerUserId;

  const buffer = useMemo(() => chunks.map((c) => c.content).join(''), [chunks]);
  const snapshot = useMemo(() => extractChapterTitles(buffer), [buffer]);
  const phases = useMemo(
    () =>
      derivePhases({
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt ?? job.cancelledAt,
        chunkCount: chunks.length,
        snapshot,
      }),
    [job.status, job.startedAt, job.completedAt, job.cancelledAt, chunks.length, snapshot],
  );

  return (
    <>
      <Stack component="header" gap={8}>
        <Text
          fz={11}
          fw={500}
          tt="uppercase"
          c={token('before')}
          style={{ letterSpacing: '0.18em' }}
        >
          ❖&nbsp;&nbsp;{phaseEyebrow(job.status)}
        </Text>
        <Title
          order={1}
          fz={{ base: 30, sm: 32 }}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.015em' }}
        >
          {phaseHeading(job.status, job.target)}
        </Title>
        <Text ff="monospace" fz={12} c="dimmed">
          {describeTarget(job.target)} · <span>{(job.headSha ?? '').slice(0, 7)}</span>
        </Text>
      </Stack>

      <JobTimeline phases={phases} />

      {job.errorMessage && (
        <Stack
          gap={4}
          p={16}
          fz="sm"
          style={{
            borderRadius: 8,
            border: `1px solid color-mix(in oklab, ${token('destructive')} 40%, transparent)`,
            background: `color-mix(in oklab, ${token('destructive')} 10%, transparent)`,
          }}
        >
          <Text component="strong" fz="sm" fw={600} c={token('destructive')}>
            Run errored
          </Text>
          <Text component="span" fz="sm" c={token('destructive')}>
            {job.errorMessage}
          </Text>
          <Text component="span" fz="sm" c="dimmed">
            {whatNowFor(job.errorMessage)}
          </Text>
        </Stack>
      )}

      <Group component="footer" justify="space-between" gap={12} wrap="nowrap">
        <Box fz="xs" c={token('destructive')}>
          {cancelError}
        </Box>
        <Group gap={12} wrap="nowrap">
          {job.status === 'done' && (
            <Button component={Link} to={`/reviews/${job.id}`} radius="xl" h={36} px={16}>
              Read the review →
            </Button>
          )}
          {(job.status === 'error' || job.status === 'cancelled') && (
            <RerunButton jobId={job.id}>Re-run</RerunButton>
          )}
          {cancellable && isOwner && (
            <Button
              variant="default"
              radius="xl"
              h={36}
              px={16}
              disabled={cancelling}
              aria-busy={cancelling}
              onClick={() => void cancel.submit({ intent: 'cancel' }, { method: 'post' })}
            >
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
        </Group>
      </Group>
    </>
  );
}
