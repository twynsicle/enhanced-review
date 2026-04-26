'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';
import type { ReviewJobRow } from '@/lib/jobs/types';
import { createClient } from '@/lib/supabase/client';

/**
 * App-wide subscriber that fires a toast (and optional browser
 * notification) when one of the viewer's review jobs reaches a terminal
 * status while they're on a different page. Mounted once in the root
 * layout.
 *
 * Suppression rules:
 *   - Only the viewer's own jobs (server-side filter on `user_id`).
 *   - Only `pending|running → done|error|cancelled` transitions.
 *   - Suppressed when the user is *currently* on `/jobs/:id` for that
 *     job — they can already see the status flip live.
 *   - Browser Notification only fires when permission is granted *and*
 *     the tab is hidden, to avoid double-notifying a focused user.
 */
export function JobNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`user-jobs:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'review_jobs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as ReviewJobRow;
          const prev = payload.old as Partial<ReviewJobRow> | null;
          const wasInFlight =
            prev?.status === 'pending' || prev?.status === 'running' || prev === null;
          const isTerminal =
            next.status === 'done' || next.status === 'error' || next.status === 'cancelled';
          if (!wasInFlight || !isTerminal) return;

          // Suppress when the user is already viewing that job.
          if (pathRef.current === `/jobs/${next.id}` || pathRef.current === `/reviews/${next.id}`) {
            return;
          }

          fireToast({ job: next, router });
          maybeFireBrowserNotification(next);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => {
        /* swallowed: layout unmounting */
      });
    };
  }, [userId, router]);

  return null;
}

function fireToast({
  job,
  router,
}: {
  job: ReviewJobRow;
  router: ReturnType<typeof useRouter>;
}) {
  const { title, description, variant, href } = describeTransition(job);
  toast({
    title,
    description,
    variant,
    action: (
      <ToastAction
        altText="View"
        onClick={(event) => {
          event.preventDefault();
          router.push(href);
        }}
      >
        View
      </ToastAction>
    ),
  });
}

function maybeFireBrowserNotification(job: ReviewJobRow) {
  if (typeof window === 'undefined') return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState !== 'hidden') return;
  const { title, description, href } = describeTransition(job);
  try {
    const n = new Notification(title, {
      body: typeof description === 'string' ? description : 'Review finished',
      tag: `review-${job.id}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      window.location.assign(href);
    };
  } catch {
    /* swallowed: some browsers throw when out of focus */
  }
}

function describeTransition(job: ReviewJobRow): {
  title: string;
  description: string;
  variant: 'success' | 'destructive' | 'default';
  href: string;
} {
  const target = describeTargetShort(job);
  if (job.status === 'done') {
    return {
      title: 'Review ready',
      description: target,
      variant: 'success',
      href: `/reviews/${job.id}`,
    };
  }
  if (job.status === 'error') {
    return {
      title: 'Review errored',
      description: job.error_message ?? target,
      variant: 'destructive',
      href: `/jobs/${job.id}`,
    };
  }
  return {
    title: 'Review cancelled',
    description: target,
    variant: 'default',
    href: `/jobs/${job.id}`,
  };
}

function describeTargetShort(job: ReviewJobRow): string {
  const t = job.target;
  if (t.kind === 'pr') return `${t.owner}/${t.repo} PR #${t.number}`;
  return `${t.owner}/${t.repo} ${t.ref}`;
}
