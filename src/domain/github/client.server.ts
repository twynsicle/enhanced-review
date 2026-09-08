import { Octokit } from '@octokit/core';
import type { GithubError, GithubResult } from './types.ts';

/**
 * One `@octokit/core` instance per request, authenticated with the viewer's
 * OAuth token from the `gh_access_token` cookie (00-overview D3). Every
 * GitHub call in the app goes through an instance from here (phase-3-plan
 * P3-D1); endpoint modules take it as their first argument so tests can pass
 * a fake `{ request, graphql }`.
 */
export type GithubClient = Pick<Octokit, 'request' | 'graphql'>;

const USER_AGENT = 'enhanced-review/0.1';

export function createOctokit(token: string): GithubClient {
  if (!token) throw new Error('createOctokit: token is required');
  return new Octokit({ auth: token, userAgent: USER_AGENT });
}

/**
 * GitHub returned 401: the OAuth token is revoked, expired or downgraded.
 * OAuth Apps issue no refresh token, so the only recovery is `/relink`.
 */
export class GithubAuthError extends Error {
  readonly status = 401;
  constructor(message = 'GitHub returned 401 — access token invalid') {
    super(message);
    this.name = 'GithubAuthError';
  }
}

interface ErrorLike {
  status?: unknown;
  message?: unknown;
  errors?: unknown;
  response?: { headers?: Record<string, unknown> } | undefined;
}

function asErrorLike(error: unknown): ErrorLike | null {
  return error && typeof error === 'object' ? (error as ErrorLike) : null;
}

/**
 * Octokit throws `RequestError` with a numeric `status`; a GraphQL query may
 * surface auth failure as `GraphqlResponseError` with `errors[].type ===
 * 'UNAUTHORIZED'`. Both count.
 */
export function isAuthError(error: unknown): boolean {
  const e = asErrorLike(error);
  if (!e) return false;
  if (e.status === 401) return true;
  return (
    Array.isArray(e.errors) &&
    e.errors.some(
      (item) =>
        item && typeof item === 'object' && (item as { type?: unknown }).type === 'UNAUTHORIZED',
    )
  );
}

/** Re-throw as `GithubAuthError` when it is one; otherwise re-throw untouched. */
export function rethrowAuth(error: unknown): never {
  if (isAuthError(error)) throw new GithubAuthError();
  throw error;
}

/** Map a thrown Octokit error to the view-time error kinds. */
export function classifyGithubError(error: unknown): GithubError {
  const e = asErrorLike(error);
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === undefined) {
    return { kind: 'unknown', message: error instanceof Error ? error.message : 'request failed' };
  }
  if (status === 401) return { kind: 'unauthorized', status };
  if (status === 404) return { kind: 'not-found', status };
  if (status === 429) return { kind: 'rate-limited', status };
  if (status === 403) {
    // GitHub uses 403 for both rate limiting and permission denial; the
    // remaining-rate header tells them apart.
    const remaining = e?.response?.headers?.['x-ratelimit-remaining'];
    if (remaining === '0' || remaining === 0) return { kind: 'rate-limited', status };
    return { kind: 'no-access', status };
  }
  return { kind: 'unknown', status };
}

/** Run a GitHub call and fold any thrown error into a `GithubResult`. */
export async function toResult<T>(call: () => Promise<T>): Promise<GithubResult<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    return { ok: false, error: classifyGithubError(error) };
  }
}
