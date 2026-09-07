import 'server-only';
import { GithubAuthError, createOctokit } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/log';
import { MissingProviderTokenError, getGithubToken } from './token';

/**
 * Build a server-side Octokit instance authenticated with the signed-in
 * user's GitHub OAuth `provider_token`. Use inside Route Handlers and
 * Server Components only.
 */
export async function createServerOctokit() {
  const token = await getGithubToken();
  return createOctokit(token);
}

/**
 * Translate a thrown error into a JSON response. Auth-related failures
 * (missing or rejected `provider_token`) get a `401` with a discriminator
 * the picker UI uses to redirect to `/relink`. Everything else surfaces
 * as a `500` with a generic message — the underlying error is logged.
 */
export function githubErrorResponse(error: unknown): NextResponse {
  if (error instanceof MissingProviderTokenError || error instanceof GithubAuthError) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
      { status: 401 },
    );
  }
  logger.error({ err: error }, '[github] unexpected error');
  return NextResponse.json(
    { reason: 'unknown', message: 'Something went wrong talking to GitHub.' },
    { status: 500 },
  );
}
