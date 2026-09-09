import { describe, expect, it } from 'vitest';
import {
  classifyGithubError,
  createOctokit,
  GithubAuthError,
  isAuthError,
  rethrowAuth,
  toResult,
} from './client.server.ts';

describe('createOctokit', () => {
  it('requires a token', () => {
    expect(() => createOctokit('')).toThrowError(/token is required/);
  });

  it('returns a client with request and graphql', () => {
    const client = createOctokit('t');
    expect(typeof client.request).toBe('function');
    expect(typeof client.graphql).toBe('function');
  });
});

describe('isAuthError', () => {
  it('returns true for an Octokit-shaped 401', () => {
    expect(isAuthError({ status: 401, message: 'Bad credentials' })).toBe(true);
  });

  it('returns true for a GraphQL UNAUTHORIZED error', () => {
    expect(isAuthError({ errors: [{ type: 'UNAUTHORIZED', message: 'Bad credentials' }] })).toBe(
      true,
    );
  });

  it('returns false for a non-auth status', () => {
    expect(isAuthError({ status: 403, message: 'forbidden' })).toBe(false);
    expect(isAuthError({ status: 500 })).toBe(false);
  });

  it('returns false for non-objects and nullish input', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError('boom')).toBe(false);
    expect(isAuthError(42)).toBe(false);
  });

  it('returns false when GraphQL errors do not include UNAUTHORIZED', () => {
    expect(isAuthError({ errors: [{ type: 'NOT_FOUND' }, { type: 'FORBIDDEN' }] })).toBe(false);
  });
});

describe('rethrowAuth', () => {
  it('rewraps auth errors as GithubAuthError', () => {
    expect(() => rethrowAuth({ status: 401 })).toThrowError(GithubAuthError);
  });

  it('passes through non-auth errors unchanged', () => {
    const err = new Error('some other failure');
    expect(() => rethrowAuth(err)).toThrow(err);
  });
});

describe('classifyGithubError', () => {
  it('maps the well-known statuses', () => {
    expect(classifyGithubError({ status: 401 })).toEqual({ kind: 'unauthorized', status: 401 });
    expect(classifyGithubError({ status: 404 })).toEqual({ kind: 'not-found', status: 404 });
    expect(classifyGithubError({ status: 429 })).toEqual({ kind: 'rate-limited', status: 429 });
    expect(classifyGithubError({ status: 500 })).toEqual({ kind: 'unknown', status: 500 });
  });

  it('tells 403 rate limiting from 403 no-access by the remaining-rate header', () => {
    expect(
      classifyGithubError({ status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } }),
    ).toEqual({ kind: 'rate-limited', status: 403 });
    expect(
      classifyGithubError({
        status: 403,
        response: { headers: { 'x-ratelimit-remaining': '4998' } },
      }),
    ).toEqual({ kind: 'no-access', status: 403 });
    expect(classifyGithubError({ status: 403 })).toEqual({ kind: 'no-access', status: 403 });
  });

  it('reports thrown non-HTTP errors as unknown with the message', () => {
    expect(classifyGithubError(new Error('network down'))).toEqual({
      kind: 'unknown',
      message: 'network down',
    });
    expect(classifyGithubError('boom')).toEqual({ kind: 'unknown', message: 'request failed' });
  });
});

describe('toResult', () => {
  it('wraps a resolved value', async () => {
    await expect(toResult(() => Promise.resolve(1))).resolves.toEqual({ ok: true, data: 1 });
  });

  it('folds a thrown error into the classified result', async () => {
    await expect(toResult(() => Promise.reject({ status: 404 }))).resolves.toEqual({
      ok: false,
      error: { kind: 'not-found', status: 404 },
    });
  });
});
