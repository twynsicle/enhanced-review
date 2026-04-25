'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { describeTarget, type ReviewChunkRow, type ReviewJobRow } from '@/lib/jobs/types';
import { createClient } from '@/lib/supabase/client';

/**
 * Live view of a single review job: status pill, streaming chunk textbox,
 * cancel button. Subscribes to Supabase Realtime for `review_jobs`
 * row updates (status flips) and `review_chunks` inserts (streamed
 * partial output) on a per-job channel.
 *
 * No "rendered review" UI here — Phase 6 builds `/reviews/:id` for that.
 * Once status flips to `done`, the page just shows the final `done` pill
 * over the chunks textbox.
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

  // Per-job channel with server-side filters so we only receive events
  // for this row. Channel name includes the id to keep it isolated.
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
            // Realtime can in theory deliver duplicates after reconnect
            // — dedupe on (id) and keep order by seq.
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
      // On success the Realtime UPDATE will flip the pill — no optimistic
      // mutation needed here.
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelInFlight(false);
    }
  }, [job.id]);

  const cancellable = job.status === 'pending' || job.status === 'running';
  const isOwner = job.user_id === viewerUserId;
  const targetLine = useMemo(() => describeTarget(job.target), [job.target]);

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

      <ChunksBox chunks={chunks} status={job.status} errorMessage={job.error_message} />

      <footer className="flex items-center justify-between gap-3">
        <div className="text-xs text-destructive">{cancelError}</div>
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

function ChunksBox({
  chunks,
  status,
  errorMessage,
}: {
  chunks: ReviewChunkRow[];
  status: ReviewJobRow['status'];
  errorMessage: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new chunk while the job is still progressing.
  // Once it's done/cancelled/errored the user controls the scroll.
  useEffect(() => {
    if (status !== 'pending' && status !== 'running') return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chunks.length, status]);

  return (
    <div
      ref={ref}
      className="min-h-[240px] max-h-[60vh] overflow-y-auto rounded-lg ring-1 ring-foreground/10 bg-card p-4 font-mono text-xs whitespace-pre-wrap"
      aria-live="polite"
    >
      {chunks.length === 0 && status === 'pending' && (
        <p className="text-muted-foreground">Waiting for the worker to pick this up…</p>
      )}
      {chunks.map((c) => (
        <div key={c.id}>{c.content}</div>
      ))}
      {errorMessage && (
        <div className="mt-3 rounded bg-destructive/10 p-2 text-destructive">{errorMessage}</div>
      )}
    </div>
  );
}
