'use client';

/**
 * Client-side fetcher for our `/api/github/...` routes.
 *
 * On 401 we redirect to `/relink` so the user can re-run the OAuth flow.
 * GitHub OAuth Apps don't issue refresh tokens, so re-running the flow
 * is the only recovery. Other non-2xx responses surface as an Error the
 * caller can render.
 */
export class FetchGithubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FetchGithubError';
    this.status = status;
  }
}

export async function fetchGithub<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: 'no-store' });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.assign('/relink');
    }
    throw new FetchGithubError(401, 'Re-link required');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // fall through with the generic message
    }
    throw new FetchGithubError(res.status, message);
  }

  return (await res.json()) as T;
}
