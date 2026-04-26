'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RerunButton } from '@/app/reviews/[id]/rerun-button';
import { Button } from '@/components/ui/button';
import { describeTarget, type ReviewChunkRow, type ReviewJobRow } from '@/lib/jobs/types';
import { extractChapterTitles } from '@/lib/jobs/partial-narrative-parse';
import { pbBrowser } from '@/lib/pb/browser';

/**
 * Live view of a single review job: status pill, chapter-title checklist
 * driven by the partial-narrative parser, cancel button. Subscribes to
 * PocketBase Realtime for `review_jobs` record updates (status flips) and
 * `review_chunks` inserts (streamed partial output).
 *
 * PB realtime does not send a snapshot on reconnect. We subscribe to
 * PB_CONNECT and re-fetch both the job record and all chunks whenever the
 * SSE connection is re-established, so gaps caused by network drops are
 * filled automatically.
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
        // Subscribe to updates on this specific job record.
        pb.collection('review_jobs').subscribe<ReviewJobRow>(job.id, (e) => {
          if (!mounted || e.action !== 'update') return;
          setJob((prev) => ({ ...prev, ...e.record }));
        }),

        // Subscribe to new chunks for this job.
        pb.collection('review_chunks').subscribe<ReviewChunkRow>(
          '*',
          (e) => {
            if (!mounted || e.action !== 'create') return;
            const incoming = e.record;
            setChunks((prev) => {
              // Dedupe on id; keep sorted by seq (PB may deliver out of order
              // after reconnect before the re-fetch lands).
              if (prev.some((c) => c.id === incoming.id)) return prev;
              const next = [...prev, incoming];
              next.sort((a, b) => a.seq - b.seq);
              return next;
            });
          },
          { filter: `job = "${job.id}"` },
        ),

        // Re-fetch on reconnect to fill gaps from any missed events.
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

      // Cleanup may have fired while setup was awaiting — call unsubs now.
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

  const buffer = useMemo(() => chunks.map((c) => c.content).join(''), [chunks]);
  const snapshot = useMemo(() => extractChapterTitles(buffer), [buffer]);

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="text-xs text-muted-foreground">
          <Link href="/history" className="hover:underline">
            ← All reviews
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-mono text-sm font-medium break-all">{targetLine}</h1>
            <p className="text-xs text-muted-foreground">
              Requested by <span className="font-medium">@{job.github_login}</span> ·{' '}
              <code className="rounded bg-muted px-1 py-0.5">{job.head_sha.slice(0, 7)}</code>
            </p>
          </div>
          <StatusPill status={job.status} />
        </div>
      </header>

      <ChapterChecklist
        snapshot={snapshot}
        status={job.status}
        startedAt={job.started_at}
        completedAt={job.completed_at ?? job.cancelled_at}
        errorMessage={job.error_message}
        hasAnyChunk={chunks.length > 0}
      />

      <footer className="flex items-center justify-between gap-3">
        <div className="text-xs text-destructive">{cancelError}</div>
        <div className="flex items-center gap-3">
          {job.status === 'done' && (
            <Button asChild>
              <Link href={`/reviews/${job.id}`}>View rendered review →</Link>
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
            >
              {cancelInFlight ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
        </div>
      </footer>
    </>
  );
}

/**
 * Map a `review_jobs.error_message` to a one-line "what now" suggestion.
 */
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

function StatusPill({ status }: { status: ReviewJobRow['status'] }) {
  const styles: Record<ReviewJobRow['status'], string> = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-primary/15 text-primary',
    done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    error: 'bg-destructive/15 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function ChapterChecklist({
  snapshot,
  status,
  startedAt,
  completedAt,
  errorMessage,
  hasAnyChunk,
}: {
  snapshot: { titles: string[]; inProgressTitle: string | null };
  status: ReviewJobRow['status'];
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  hasAnyChunk: boolean;
}) {
  const isStreaming = status === 'pending' || status === 'running';
  const titles = isStreaming
    ? snapshot.titles
    : [...snapshot.titles, ...(snapshot.inProgressTitle ? [snapshot.inProgressTitle] : [])];
  const inProgress = isStreaming ? snapshot.inProgressTitle : null;
  const hasAnyTitle = titles.length > 0 || inProgress !== null;

  return (
    <div
      className="min-h-[240px] rounded-lg ring-1 ring-foreground/10 bg-card p-6 font-mono text-sm"
      aria-live="polite"
    >
      {!hasAnyTitle && status === 'pending' && (
        <div className="flex flex-col gap-1 text-muted-foreground">
          <p>Setting up your review…</p>
          <p className="text-xs">
            Cloning the repo and starting the reviewer.
          </p>
        </div>
      )}
      {!hasAnyTitle && status === 'running' && (
        <div className="flex flex-col gap-1 text-muted-foreground">
          <p>Reading the diff…</p>
          <p className="text-xs">
            The first chapter title will appear here as soon as the model starts streaming.
          </p>
        </div>
      )}
      {!hasAnyTitle && status === 'cancelled' && (
        <p className="text-muted-foreground">
          Cancelled before any chapter content streamed in.
        </p>
      )}
      {!hasAnyTitle && status === 'error' && !errorMessage && (
        <p className="text-destructive">Run errored before producing any output.</p>
      )}

      {hasAnyTitle && (
        <ul className="flex flex-col gap-2">
          {titles.map((t, idx) => (
            <li key={`${String(idx)}:${t}`} className="flex items-start gap-2">
              <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                ✓
              </span>
              <span>{t}</span>
            </li>
          ))}
          {inProgress !== null && (
            <li className="flex items-start gap-2 text-muted-foreground">
              <span aria-hidden className="opacity-50">
                ◦
              </span>
              <span>
                {inProgress}
                <span className="ml-0.5 inline-block w-2 animate-pulse">▍</span>
              </span>
            </li>
          )}
        </ul>
      )}

      <div className="mt-6 border-t border-foreground/10 pt-3 text-xs text-muted-foreground">
        <ChecklistFooter
          status={status}
          startedAt={startedAt}
          completedAt={completedAt}
          hasAnyChunk={hasAnyChunk}
        />
      </div>

      {errorMessage && (
        <div className="mt-3 flex flex-col gap-1 rounded bg-destructive/10 p-2 text-xs text-destructive">
          <span>{errorMessage}</span>
          <span className="text-foreground/70">{whatNowFor(errorMessage)}</span>
        </div>
      )}
    </div>
  );
}

function ChecklistFooter({
  status,
  startedAt,
  completedAt,
  hasAnyChunk,
}: {
  status: ReviewJobRow['status'];
  startedAt: string | null;
  completedAt: string | null;
  hasAnyChunk: boolean;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const completedMs = completedAt ? new Date(completedAt).getTime() : null;

  if (status === 'pending') return <span>Starting up…</span>;
  if (status === 'running') {
    if (startMs === null || nowMs === null) return <span>Streaming…</span>;
    const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    return (
      <span>
        Streaming for {elapsedSec}s
        <span aria-hidden>···</span>
      </span>
    );
  }
  if (status === 'done') {
    if (startMs === null || completedMs === null) return <span>Done.</span>;
    const totalSec = Math.max(0, Math.floor((completedMs - startMs) / 1000));
    return <span>Streamed in {totalSec}s.</span>;
  }
  if (status === 'cancelled') {
    return <span>{hasAnyChunk ? 'Cancelled · partial output preserved.' : 'Cancelled.'}</span>;
  }
  return <span>Run errored.</span>;
}
