'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { describeTarget, type ReviewChunkRow, type ReviewJobRow } from '@/lib/jobs/types';
import { extractChapterTitles } from '@/lib/jobs/partial-narrative-parse';
import { createClient } from '@/lib/supabase/client';

/**
 * Live view of a single review job: status pill, chapter-title checklist
 * driven by the partial-narrative parser, cancel button. Subscribes to
 * Supabase Realtime for `review_jobs` row updates (status flips) and
 * `review_chunks` inserts (streamed partial output).
 *
 * The chunks themselves are an implementation detail — the user sees
 * detected chapter titles forming with a typing cursor on the in-progress
 * one. When status flips to `done`, the cursor goes away and a CTA links
 * to `/reviews/:id` (Phase 6 owns that page).
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
    const supabase = createClient();
    const channel = supabase
      .channel(`jobs:${job.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'review_jobs',
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          const next = payload.new as ReviewJobRow;
          setJob((prev) => ({ ...prev, ...next }));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'review_chunks',
          filter: `job_id=eq.${job.id}`,
        },
        (payload) => {
          const incoming = payload.new as ReviewChunkRow;
          setChunks((prev) => {
            // Realtime can in theory deliver duplicates after reconnect;
            // dedupe on (id) and keep order by seq.
            if (prev.some((c) => c.id === incoming.id)) return prev;
            const next = [...prev, incoming];
            next.sort((a, b) => a.seq - b.seq);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => {
        /* swallowed: page is unmounting */
      });
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
  const isOwner = job.user_id === viewerUserId;
  const targetLine = useMemo(() => describeTarget(job.target), [job.target]);

  // Accumulate the raw stream into a single buffer so the partial parser
  // sees the full prefix. Memoised on `chunks` reference so re-renders
  // from unrelated state don't re-concat.
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
  // Once streaming has finished, ignore any in-flight title — it's a
  // partial-parse artefact, not a real chapter.
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
        <p className="text-muted-foreground">Waiting for the worker to pick this up…</p>
      )}
      {!hasAnyTitle && status === 'running' && (
        <p className="text-muted-foreground">Streaming…</p>
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
        <div className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
          {errorMessage}
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
  // Snapshot of `Date.now()` updated by the running-state interval. Reads
  // are pure during render. The first second shows "Streaming…" before
  // the first tick lands — acceptable.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const completedMs = completedAt ? new Date(completedAt).getTime() : null;

  if (status === 'pending') return <span>Queued · waiting for a worker.</span>;
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
