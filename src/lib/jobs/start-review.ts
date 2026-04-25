'use client';

import type { ReviewTarget } from '@enhanced-review/github-client';

/**
 * POST a `ReviewTarget` to `/api/jobs` and return the new job id.
 *
 * On 401 with `reason: 'github_token_invalid'` we redirect the user to
 * `/relink` (same pattern as `lib/github/fetcher.ts`) and throw so the
 * caller can stop its in-flight UI. Other non-2xx responses surface as
 * Errors with a renderable message.
 */
export async function startReview(target: ReviewTarget): Promise<{ id: string }> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(target),
    cache: 'no-store',
  });

  if (res.status === 401) {
    let body: { reason?: string } = {};
    try {
      body = (await res.json()) as { reason?: string };
    } catch {
      /* fall through */
    }
    if (body.reason === 'github_token_invalid' && typeof window !== 'undefined') {
      window.location.assign('/relink');
    }
    throw new Error('Re-link required');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* fall through */
    }
    throw new Error(message);
  }

  return (await res.json()) as { id: string };
}
