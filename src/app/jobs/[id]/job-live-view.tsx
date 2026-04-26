'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RerunButton } from '@/app/reviews/[id]/rerun-button';
import { Button } from '@/components/ui/button';
import { describeTarget, type ReviewChunkRow, type ReviewJobRow } from '@/lib/jobs/types';
import { extractChapterTitles } from '@/lib/jobs/partial-narrative-parse';
import { pbBrowser } from '@/lib/pb/browser';
import { cn } from '@/lib/utils';

/**
 * Live view of a single review job, rendered as a typographic timeline.
 * Three logical phases derived from the actual job state — Setting up
 * (pending) → Reading the diff (running, no chunks yet) → Composing the
 * narrative (running with chunks). The active phase shows the
 * partial-narrative parser's chapter-title checklist nested inside it.
 *
 * Subscribes to PocketBase realtime for `review_jobs` updates (status
 * flips) and `review_chunks` inserts (streamed partial output). PB
 * realtime does not send a snapshot on reconnect — we re-fetch on
 * `PB_CONNECT` so gaps caused by network drops are filled.
 */
export function JobLiveView({
  initialJob,
  initialChunks,
  viewerUserId,
}: {
  initialJob: ReviewJobRow;
  initialChunks: ReviewChunkRow[];
  viewerUserId: string;
}) {
  const [job, setJob] = useState<ReviewJobRow>(initialJob);
  const [chunks, setChunks] = useState<ReviewChunkRow[]>(initialChunks);
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    const pb = pbBrowser();
    let mounted = true;
    const unsubFns: Array<() => void> = [];

    async function setup() {
      const [unsubJob, unsubChunks, unsubConnect] = await Promise.all([
        pb.collection('review_jobs').subscribe<ReviewJobRow>(job.id, (e) => {
          if (!mounted || e.action !== 'update') return;
          setJob((prev) => ({ ...prev, ...e.record }));
        }),

        pb.collection('review_chunks').subscribe<ReviewChunkRow>(
          '*',
          (e) => {
            if (!mounted || e.action !== 'create') return;
            const incoming = e.record;
            setChunks((prev) => {
              if (prev.some((c) => c.id === incoming.id)) return prev;
              const next = [...prev, incoming];
              next.sort((a, b) => a.seq - b.seq);
              return next;
            });
          },
          { filter: `job = "${job.id}"` },
        ),

        pb.realtime.subscribe('PB_CONNECT', async () => {
          if (!mounted) return;
          try {
            const [latestJob, latestChunks] = await Promise.all([
              pb.collection('review_jobs').getOne<ReviewJobRow>(job.id),
              pb
                .collection('review_chunks')
                .getFullList<ReviewChunkRow>({ filter: `job = "${job.id}"`, sort: 'seq' }),
            ]);
            if (mounted) {
              setJob(latestJob);
              setChunks(latestChunks);
            }
          } catch {
            /* swallowed: page still has the server-fetched snapshot */
          }
        }),
      ]);

      unsubFns.push(unsubJob, unsubChunks, unsubConnect);

      if (!mounted) {
        for (const fn of unsubFns) fn();
      }
    }

    setup().catch(() => { /* swallowed */ });

    return () => {
      mounted = false;
      for (const fn of unsubFns) fn();
    };
  }, [job.id]);

  const onCancel = useCallback(async () => {
    setCancelInFlight(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/cancel`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setCancelError(body.message ?? `Cancel failed (${res.status})`);
      }
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelInFlight(false);
    }
  }, [job.id]);

  const cancellable = job.status === 'pending' || job.status === 'running';
  const isOwner = job.user === viewerUserId;
  const targetLine = useMemo(() => describeTarget(job.target), [job.target]);
  const targetTitle = useMemo(() => describeTargetTitle(job.target), [job.target]);

  const buffer = useMemo(() => chunks.map((c) => c.content).join(''), [chunks]);
  const snapshot = useMemo(() => extractChapterTitles(buffer), [buffer]);
  const phases = useMemo(
    () =>
      derivePhases({
        status: job.status,
        startedAt: job.started_at,
        completedAt: job.completed_at ?? job.cancelled_at,
        chunkCount: chunks.length,
        snapshot,
      }),
    [job.status, job.started_at, job.completed_at, job.cancelled_at, chunks.length, snapshot],
  );

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">
          ❖&nbsp;&nbsp;{phaseEyebrow(job.status)}
        </p>
        <h1 className="font-serif text-3xl font-semibold leading-[1.1] tracking-[-0.015em] sm:text-[32px]">
          {phaseHeading(job.status, targetTitle)}
        </h1>
        <p className="font-mono text-[12px] text-muted-foreground">
          {targetLine} · <span>{job.head_sha.slice(0, 7)}</span>
        </p>
      </header>

      <Timeline phases={phases} />

      {job.error_message && (
        <div className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <strong className="font-semibold text-destructive">Run errored</strong>
          <span className="text-destructive">{job.error_message}</span>
          <span className="text-muted-foreground">{whatNowFor(job.error_message)}</span>
        </div>
      )}

      <footer className="flex items-center justify-between gap-3">
        <div className="text-xs text-destructive">{cancelError}</div>
        <div className="flex items-center gap-3">
          {job.status === 'done' && (
            <Button asChild className="h-9 rounded-full px-4">
              <Link href={`/reviews/${job.id}`}>Read the review →</Link>
            </Button>
          )}
          {(job.status === 'error' || job.status === 'cancelled') && (
            <RerunButton jobId={job.id}>Re-run</RerunButton>
          )}
          {cancellable && isOwner && (
            <Button
              variant="outline"
              disabled={cancelInFlight}
              onClick={onCancel}
              aria-busy={cancelInFlight}
              className="h-9 rounded-full px-4"
            >
              {cancelInFlight ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
        </div>
      </footer>
    </>
  );
}

type PhaseState = 'done' | 'active' | 'pending' | 'error' | 'cancelled';

interface Phase {
  id: string;
  label: string;
  detail: string;
  state: PhaseState;
  /** Optional nested checklist of titles streamed during this phase. */
  titles?: { state: 'done' | 'active'; text: string }[];
  /** Stamp shown in the right gutter, e.g. "1.8s" or "now". */
  stamp?: string;
}

function derivePhases(args: {
  status: ReviewJobRow['status'];
  startedAt: string | null;
  completedAt: string | null;
  chunkCount: number;
  snapshot: { titles: string[]; inProgressTitle: string | null };
}): Phase[] {
  const { status, startedAt, completedAt, chunkCount, snapshot } = args;

  const setupState: PhaseState =
    status === 'pending'
      ? 'active'
      : 'done';

  const readingState: PhaseState =
    status === 'pending'
      ? 'pending'
      : (status === 'running' && chunkCount === 0)
        ? 'active'
        : 'done';

  const writingState: PhaseState = (() => {
    if (status === 'pending') return 'pending';
    if (status === 'running') return chunkCount > 0 ? 'active' : 'pending';
    if (status === 'done') return 'done';
    if (status === 'error') return 'error';
    if (status === 'cancelled') return 'cancelled';
    return 'pending';
  })();

  const titles = (() => {
    const isStreaming = status === 'pending' || status === 'running';
    const all = isStreaming
      ? snapshot.titles
      : [...snapshot.titles, ...(snapshot.inProgressTitle ? [snapshot.inProgressTitle] : [])];
    const inProgress = isStreaming ? snapshot.inProgressTitle : null;
    const out: { state: 'done' | 'active'; text: string }[] = [];
    for (const t of all) out.push({ state: 'done', text: t });
    if (inProgress) out.push({ state: 'active', text: inProgress });
    return out;
  })();

  const totalSec =
    startedAt && completedAt
      ? Math.max(0, Math.floor((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : null;

  const phases: Phase[] = [
    {
      id: 'setup',
      label: 'Setting up',
      detail: 'Cloning the repo and starting the reviewer.',
      state: setupState,
      stamp: setupState === 'active' ? 'now' : setupState === 'done' ? '✓' : undefined,
    },
    {
      id: 'reading',
      label: 'Reading the diff',
      detail:
        readingState === 'done'
          ? 'Read.'
          : readingState === 'active'
            ? 'Mapping changed files…'
            : 'Pending — starts once the clone settles.',
      state: readingState,
      stamp: readingState === 'active' ? 'now' : undefined,
    },
    {
      id: 'writing',
      label: 'Composing the narrative',
      detail: writingPhaseDetail(writingState, chunkCount, titles.length),
      state: writingState,
      titles: writingState === 'active' ? titles : undefined,
      stamp:
        writingState === 'done' && totalSec !== null
          ? `${totalSec.toString()}s`
          : writingState === 'active'
            ? 'now'
            : undefined,
    },
  ];

  return phases;
}

function writingPhaseDetail(state: PhaseState, chunkCount: number, titleCount: number): string {
  if (state === 'pending') return 'Pending — starts when reading settles.';
  if (state === 'active') {
    if (titleCount === 0) return 'Streaming chapter titles…';
    return `${titleCount.toString()} chapter${titleCount === 1 ? '' : 's'} so far.`;
  }
  if (state === 'done') return `${chunkCount.toString()} chunk${chunkCount === 1 ? '' : 's'} streamed.`;
  if (state === 'error') return 'Streaming halted — see error below.';
  if (state === 'cancelled') return chunkCount > 0 ? 'Cancelled · partial output preserved.' : 'Cancelled.';
  return '';
}

function phaseEyebrow(status: ReviewJobRow['status']): string {
  if (status === 'done') return 'Review complete';
  if (status === 'error') return 'Review errored';
  if (status === 'cancelled') return 'Review cancelled';
  return 'Composing your review';
}

function phaseHeading(status: ReviewJobRow['status'], targetTitle: string): string {
  if (status === 'done') return `Read ${targetTitle}`;
  return `Reading ${targetTitle}`;
}

function describeTargetTitle(target: ReviewJobRow['target']): string {
  if (target.kind === 'pr') return target.title;
  return target.ref;
}

/** Map a `review_jobs.error_message` to a one-line "what now" suggestion. */
function whatNowFor(errorMessage: string): string {
  const m = errorMessage.toLowerCase();
  if (m.startsWith('timeout')) {
    return 'The review hit the time limit. Try Re-run; if it keeps timing out, narrow the diff scope.';
  }
  if (m.startsWith('token')) {
    return 'GitHub token issue — re-link your account from the home page, then Re-run.';
  }
  if (m.startsWith('clone') && m.includes('mismatch')) {
    return 'The PR moved since the review started. Click Re-run to pick up the latest commits.';
  }
  if (m.startsWith('clone') || m.startsWith('git')) {
    return 'Clone failed — check the repo permissions on GitHub, then Re-run.';
  }
  if (m.startsWith('github')) {
    return 'GitHub API error. Try again in a minute, or check repo access.';
  }
  if (m.startsWith('stream cap exceeded')) {
    return 'The review output exceeded the streaming cap. The diff may be too large; try a smaller scope.';
  }
  if (m.startsWith('parse') || m.startsWith('executor')) {
    return 'The reviewer model returned unparseable output. Re-run usually clears it; if not, contact the operator.';
  }
  return 'Click Re-run to try again, or contact the operator if it persists.';
}

function Timeline({ phases }: { phases: Phase[] }) {
  return (
    <ol className="relative flex flex-col gap-7 pl-8" aria-live="polite">
      <span
        aria-hidden
        className="absolute left-[11px] top-2 bottom-2 w-px"
        style={{ background: 'linear-gradient(var(--iris), var(--border))' }}
      />
      {phases.map((p) => (
        <li key={p.id} className="relative flex flex-col gap-1.5">
          <PhaseMarker state={p.state} />
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-serif text-[17px] font-semibold tracking-[-0.005em]">{p.label}</h3>
            {p.stamp && <span className="font-mono text-[11px] text-subtle">{p.stamp}</span>}
          </div>
          <p className="text-[13px] text-muted-foreground text-pretty">{p.detail}</p>
          {p.titles && p.titles.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border border-iris/25 bg-iris-soft p-3">
              {p.titles.map((t, i) => (
                <span
                  key={`${i.toString()}:${t.text}`}
                  className={cn(
                    'font-serif text-[14px]',
                    t.state === 'done' ? 'text-iris-ink' : 'italic text-muted-foreground',
                  )}
                >
                  {t.state === 'done' ? '✓' : '◦'} {t.text}
                  {t.state === 'active' && (
                    <span aria-hidden className="ml-1 inline-block animate-pulse">▍</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function PhaseMarker({ state }: { state: PhaseState }) {
  const symbol =
    state === 'done' ? '✓' : state === 'active' ? '●' : state === 'error' ? '!' : '';
  const styles = (() => {
    if (state === 'pending') return { bg: 'var(--background)', border: 'var(--border)', fg: 'var(--iris)' };
    if (state === 'active') return { bg: 'var(--iris)', border: 'var(--iris)', fg: 'var(--background)' };
    if (state === 'error') return { bg: 'var(--destructive)', border: 'var(--destructive)', fg: 'var(--background)' };
    return { bg: 'var(--surface-2)', border: 'var(--iris)', fg: 'var(--iris)' };
  })();
  return (
    <span
      aria-hidden
      className="absolute -left-[28px] top-0.5 grid size-5 place-items-center rounded-full text-[10px]"
      style={{
        background: styles.bg,
        border: `1.5px solid ${styles.border}`,
        color: styles.fg,
      }}
    >
      {symbol}
    </span>
  );
}
