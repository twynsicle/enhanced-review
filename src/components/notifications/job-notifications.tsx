'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';

/**
 * App-wide subscriber for cross-page review-completion toasts. Mounts in
 * the root layout once per signed-in session and listens to
 * `/api/me/notifications` (SSE backed by Postgres LISTEN/NOTIFY on
 * channel `user_<userId>:terminal`).
 *
 * One event per terminal transition while connected; no replay on
 * reconnect (matches the legacy PB-realtime semantics).
 *
 * Suppression rules:
 *   - Fire at most once per job per session (tracked in `notifiedRef`).
 *   - Suppress when the user is *currently* on `/jobs/:id` or
 *     `/reviews/:id` for that job — the live view already shows it.
 *   - Browser Notification only fires when permission is granted *and*
 *     the tab is hidden, to avoid double-notifying a focused user.
 *
 * `userId` is taken from the Auth.js session in the root layout.
 */
interface TerminalEvent {
  jobId: string;
  status: 'done' | 'error' | 'cancelled';
  riskScore?: number | null;
  errorMessage?: string;
  target?: TerminalTarget;
}

type TerminalTarget =
  | { kind: 'pr'; owner: string; repo: string; number: number; title?: string }
  | { kind: 'branch'; owner: string; repo: string; ref: string };

export function JobNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!userId) return;
    const es = new EventSource('/api/me/notifications');

    const onTerminal = (e: MessageEvent) => {
      let payload: TerminalEvent;
      try {
        payload = JSON.parse(e.data) as TerminalEvent;
      } catch {
        return;
      }
      if (!payload.jobId || !payload.status) return;
      if (notifiedRef.current.has(payload.jobId)) return;
      notifiedRef.current.add(payload.jobId);

      if (
        pathRef.current === `/jobs/${payload.jobId}` ||
        pathRef.current === `/reviews/${payload.jobId}`
      ) {
        return;
      }

      fireToast({ event: payload, router });
      maybeFireBrowserNotification(payload);
    };

    es.addEventListener('terminal', onTerminal);
    return () => {
      es.removeEventListener('terminal', onTerminal);
      es.close();
    };
  }, [userId, router]);

  return null;
}

function fireToast({
  event,
  router,
}: {
  event: TerminalEvent;
  router: ReturnType<typeof useRouter>;
}) {
  const { title, description, variant, href } = describeTransition(event);
  toast({
    title,
    description,
    variant,
    action: (
      <ToastAction
        altText="View"
        onClick={(e) => {
          e.preventDefault();
          router.push(href);
        }}
      >
        View
      </ToastAction>
    ),
  });
}

function maybeFireBrowserNotification(event: TerminalEvent) {
  if (typeof window === 'undefined') return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState !== 'hidden') return;
  const { title, description, href } = describeTransition(event);
  try {
    const n = new Notification(title, {
      body: typeof description === 'string' ? description : 'Review finished',
      tag: `review-${event.jobId}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      window.location.assign(href);
    };
  } catch {
    /* swallowed */
  }
}

function describeTransition(event: TerminalEvent): {
  title: string;
  description: string;
  variant: 'success' | 'destructive' | 'default';
  href: string;
} {
  const targetText = describeTargetShort(event.target);
  if (event.status === 'done') {
    return {
      title: 'Review ready',
      description: targetText,
      variant: 'success',
      href: `/reviews/${event.jobId}`,
    };
  }
  if (event.status === 'error') {
    return {
      title: 'Review errored',
      description: event.errorMessage ?? targetText,
      variant: 'destructive',
      href: `/jobs/${event.jobId}`,
    };
  }
  return {
    title: 'Review cancelled',
    description: targetText,
    variant: 'default',
    href: `/jobs/${event.jobId}`,
  };
}

function describeTargetShort(target: TerminalTarget | undefined): string {
  if (!target) return 'review';
  if (target.kind === 'pr') return `${target.owner}/${target.repo} PR #${String(target.number)}`;
  return `${target.owner}/${target.repo} ${target.ref}`;
}
