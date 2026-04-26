'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Posts to `POST /api/jobs/:id/rerun` and navigates to the new job's
 * live page. Used in two places: the persistent header button and the
 * staleness banner CTA. The same button has two visual variants — pass
 * `variant` to switch.
 */
export function RerunButton({
  jobId,
  variant = 'header',
  children,
}: {
  jobId: string;
  variant?: 'header' | 'banner';
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/rerun`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string };
        if (body.reason === 'github_token_invalid') {
          window.location.assign('/relink');
          return;
        }
        setError('Sign in required.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Re-run failed (${String(res.status)})`);
        return;
      }
      const body = (await res.json()) as { id: string };
      router.push(`/jobs/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-run failed');
    } finally {
      setBusy(false);
    }
  }, [jobId, router]);

  if (variant === 'banner') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onClick}
          aria-busy={busy}
          className="rounded bg-sky-500/20 px-2.5 py-1 text-sm font-medium text-sky-900 hover:bg-sky-500/30 disabled:opacity-60 dark:text-sky-100"
        >
          {busy ? 'Re-running…' : (children ?? 'Re-run →')}
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={onClick} aria-busy={busy}>
        {busy ? 'Re-running…' : (children ?? 'Re-run')}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
