import { describe, expect, it } from 'vitest';
import { GithubAuthError, isAuthError, rethrowAuth } from './errors';

describe('isAuthError', () => {
  it('returns true for an Octokit-shaped 401', () => {
    expect(isAuthError({ status: 401, message: 'Bad credentials' })).toBe(true);
  });

  it('returns true for a GraphQL UNAUTHORIZED error', () => {
    expect(
      isAuthError({
        errors: [{ type: 'UNAUTHORIZED', message: 'Bad credentials' }],
      }),
    ).toBe(true);
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
    expect(
      isAuthError({
        errors: [{ type: 'NOT_FOUND' }, { type: 'FORBIDDEN' }],
      }),
    ).toBe(false);
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
