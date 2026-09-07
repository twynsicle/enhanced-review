'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';
import type { ReviewJobRow } from '@/lib/jobs/types';
import { pbBrowser } from '@/lib/pb/browser';

/**
 * App-wide subscriber that fires a toast (and optional browser
 * notification) when one of the viewer's review jobs reaches a terminal
 * status while they're on a different page. Mounted once in the root
 * layout.
 *
 * PocketBase realtime does not expose the previous record value, so we
 * cannot check `wasInFlight` directly. Instead we track which job IDs
 * have already triggered a notification in a ref and fire exactly once
 * per terminal transition per session.
 *
 * Suppression rules:
 *   - Only the viewer's own jobs (server-side filter on `user`).
 *   - Only `pending|running → done|error|cancelled` transitions (tracked
 *     locally via `notifiedRef`).
 *   - Suppressed when the user is *currently* on `/jobs/:id` or
 *     `/reviews/:id` for that job — they can already see the status live.
 *   - Browser Notification only fires when permission is granted *and*
 *     the tab is hidden, to avoid double-notifying a focused user.
 */
export function JobNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);

  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const pb = pbBrowser();
    let mounted = true;
    const unsubFns: Array<() => void> = [];

    async function setup() {
      const unsubJobs = await pb.collection('review_jobs').subscribe<ReviewJobRow>(
        '*',
        (e) => {
          if (!mounted || e.action !== 'update') return;
          const job = e.record;

          const isTerminal =
            job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
          if (!isTerminal) return;

          // Fire at most once per job per session.
          if (notifiedRef.current.has(job.id)) return;
          notifiedRef.current.add(job.id);

          // Suppress when the user is already viewing that job.
          if (pathRef.current === `/jobs/${job.id}` || pathRef.current === `/reviews/${job.id}`) {
            return;
          }

          fireToast({ job, router });
          maybeFireBrowserNotification(job);
        },
        { filter: `user = "${userId}"` },
      );

      unsubFns.push(unsubJobs);

      if (!mounted) {
        for (const fn of unsubFns) fn();
      }
    }

    setup().catch(() => {
      /* swallowed */
    });

    return () => {
      mounted = false;
      for (const fn of unsubFns) fn();
    };
  }, [userId, router]);

  return null;
}

function fireToast({ job, router }: { job: ReviewJobRow; router: ReturnType<typeof useRouter> }) {
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
