'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

/**
 * GitHub sign-in via Auth.js. Redirects to `/api/auth/signin/github`, which
 * bounces through the GitHub OAuth flow and back to `/api/auth/callback/github`.
 * The `signIn` callback in `src/lib/auth/auth.ts` enforces the allowlist gate
 * before creating the session row.
 */
export function SignInButton() {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      onClick={() => {
        setLoading(true);
        void signIn('github', { callbackUrl: '/' });
      }}
      disabled={loading}
      className="w-full"
    >
      {loading ? 'Signing in…' : 'Sign in with GitHub'}
    </Button>
  );
}
