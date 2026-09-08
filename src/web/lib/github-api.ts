import type {
  GithubError,
  GithubErrorKind,
  PullSummary,
  RecentBranchesResult,
  RepoSummary,
} from '@/domain/github/types';

/**
 * Bodies of the `/api/github/*` resource routes, shared by the loaders and
 * the components that `useFetcher().load()` them. Failures are *returned*
 * (with a status) rather than thrown so a rate limit degrades one picker
 * instead of tripping the page's error boundary; a rejected token never gets
 * here — the loader redirects to `/relink` (phase-4-plan P4-D7).
 */
export interface GithubFailure {
  ok: false;
  error: GithubError;
  message: string;
}

export type ReposResponse = { ok: true; repos: RepoSummary[] } | GithubFailure;

/** `fullName` echoes the request so a stale response for another repo is ignored. */
export type PullsResponse = { ok: true; fullName: string; pulls: PullSummary[] } | GithubFailure;

export type BranchesResponse =
  ({ ok: true; fullName: string } & RecentBranchesResult) | GithubFailure;

export const GITHUB_ERROR_STATUS: Record<GithubErrorKind, number> = {
  unauthorized: 401,
  'no-access': 403,
  'not-found': 404,
  'too-large': 413,
  'rate-limited': 429,
  unknown: 502,
};

export function describeGithubError(error: GithubError): string {
  switch (error.kind) {
    case 'no-access':
      return "You don't have access to this repository on GitHub.";
    case 'not-found':
      return 'GitHub returned 404 for this request.';
    case 'too-large':
      return 'The response was too large for GitHub to return.';
    case 'rate-limited':
      return 'GitHub API rate limit reached. Try again in a minute.';
    case 'unauthorized':
      return 'GitHub authentication expired. Re-link your account.';
    default:
      return error.message ? `GitHub error: ${error.message}` : 'GitHub returned an error.';
  }
}
