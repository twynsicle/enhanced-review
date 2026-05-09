'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

/**
 * Re-runs the GitHub OAuth flow with the same `repo` scope. Auth.js's
 * `signIn('github')` against an existing session re-authenticates and
 * overwrites the `accounts` row with the fresh access token. No special
 * "relink" code path is needed.
 */
export function RelinkButton() {
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
      {loading ? 'Re-linking…' : 'Re-link GitHub'}
    </Button>
  );
}
