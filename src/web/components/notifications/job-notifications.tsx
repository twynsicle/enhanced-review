import { Anchor } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { JobView } from '@/domain/jobs/job-view';
import { isTerminalJobsResponse } from '@/web/lib/jobs-api';
import { usePolling } from '@/web/lib/use-polling';

type Tone = 'success' | 'destructive' | 'default';

/**
 * A terminal row's `updated_at` is assigned before its transaction commits,
 * so a poll can run in the gap and the next `since` would skip it. Later
 * polls therefore look back this far behind the previous server clock; the
 * per-id set keeps the overlap from toasting twice.
 */
const TERMINAL_OVERLAP_MS = 30_000;

const TONE_COLOR: Record<Tone, string> = {
  success: 'mint',
  destructive: 'risk',
  default: 'gray',
};

function describeTargetShort(job: JobView): string {
  const t = job.target;
  if (t.kind === 'pr') return `${t.owner}/${t.repo} PR #${String(t.number)}`;
  return `${t.owner}/${t.repo} ${t.ref}`;
}

/** The toast copy and destination for a job that just turned terminal. */
export function describeTransition(job: JobView): {
  title: string;
  description: string;
  tone: Tone;
  href: string;
} {
  const target = describeTargetShort(job);
  if (job.status === 'done') {
    return {
      title: 'Review ready',
      description: target,
      tone: 'success',
      href: `/reviews/${job.id}`,
    };
  }
  if (job.status === 'error') {
    return {
      title: 'Review errored',
      description: job.errorMessage ?? target,
      tone: 'destructive',
      href: `/jobs/${job.id}`,
    };
  }
  return {
    title: 'Review cancelled',
    description: target,
    tone: 'default',
    href: `/jobs/${job.id}`,
  };
}

function maybeFireBrowserNotification(job: JobView): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState !== 'hidden') return;
  const { title, description, href } = describeTransition(job);
  try {
    const n = new Notification(title, { body: description, tag: `review-${job.id}` });
    n.addEventListener('click', () => {
      window.focus();
      n.close();
      window.location.assign(href);
    });
  } catch {
    // Some browsers throw when the window is out of focus.
  }
}

/**
 * Cross-page notifier: polls `/api/me/jobs/terminal` at `terminalMs`,
 * starting from the shell loader's `serverNow` and advancing to each
 * response's `now` (less an overlap window). A job that turned terminal
 * toasts once per id per session, except while the viewer is already on that
 * job's live view or reader; a browser `Notification` fires as well when the
 * tab is hidden and permission was granted. Mounted once by `_shell`.
 */
export function JobNotifications({
  serverNow,
  terminalMs,
}: {
  serverNow: string;
  terminalMs: number;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  const sinceRef = useRef(serverNow);
  const notifiedRef = useRef(new Set<string>());
  const inFlightRequest = useRef<Promise<void> | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const fireToast = useCallback(
    (job: JobView) => {
      const { title, description, tone, href } = describeTransition(job);
      const id = `job-${job.id}`;
      notifications.show({
        id,
        title,
        color: TONE_COLOR[tone],
        // Stays until dismissed or followed.
        autoClose: false,
        message: (
          <>
            {description}{' '}
            <Anchor
              component="button"
              type="button"
              fz="inherit"
              fw={600}
              onClick={() => {
                notifications.hide(id);
                void navigate(href);
              }}
            >
              View
            </Anchor>
          </>
        ),
      });
    },
    [navigate],
  );

  const tick = useCallback(() => {
    if (inFlightRequest.current) return;
    inFlightRequest.current = (async () => {
      try {
        const res = await fetch(
          `/api/me/jobs/terminal?since=${encodeURIComponent(sinceRef.current)}`,
          { headers: { accept: 'application/json' }, cache: 'no-store' },
        );
        if (!res.ok) return;
        const body: unknown = await res.json().catch(() => null);
        if (!isTerminalJobsResponse(body)) return;
        sinceRef.current = new Date(Date.parse(body.now) - TERMINAL_OVERLAP_MS).toISOString();
        for (const job of body.jobs) {
          if (notifiedRef.current.has(job.id)) continue;
          notifiedRef.current.add(job.id);
          const path = pathRef.current;
          if (path === `/jobs/${job.id}` || path === `/reviews/${job.id}`) continue;
          fireToast(job);
          maybeFireBrowserNotification(job);
        }
      } catch {
        // Network blips are covered by the next tick.
      } finally {
        inFlightRequest.current = null;
      }
    })();
  }, [fireToast]);

  usePolling({ enabled: true, intervalMs: terminalMs, tick });

  return null;
}
