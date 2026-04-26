'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { pbBrowser } from '@/lib/pb/browser';

/**
 * GitHub sign-in via PocketBase. Opens a popup at PB's OAuth URL; PB hits
 * its `/api/oauth2-redirect` callback when GitHub completes, then notifies
 * the parent window over realtime — `authWithOAuth2` resolves with the
 * session and the upstream provider data.
 *
 * After the popup closes successfully we POST the GitHub access token +
 * username to the server so it can set the HttpOnly `gh_access_token`
 * cookie and backfill `github_login` on the user record. Then a full reload
 * lets `proxy.ts` re-evaluate the allowlist and route us to / or /denied.
 */
export function SignInButton() {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    try {
      const pb = pbBrowser();
      const authData = await pb.collection('users').authWithOAuth2({
        provider: 'github',
        // Match the PB-side provider config (RUNNING-pocketbase.md §5).
        // The cloning step in the runner needs this scope.
        scopes: ['repo'],
      });

      const meta = (authData.meta ?? {}) as {
        accessToken?: string;
        username?: string;
        name?: string;
      };
      if (!meta.accessToken || !meta.username) {
        throw new Error('GitHub OAuth did not return an access token / username');
      }

      const res = await fetch('/api/auth/post-signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken: meta.accessToken,
          githubLogin: meta.username,
          name: meta.name,
        }),
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`post-signin failed: ${res.status}`);
      }

      window.location.href = '/';
    } catch (error) {
      console.error('[sign-in] OAuth init failed', error);
      setLoading(false);
    }
  }

  return (
    <Button onClick={signIn} disabled={loading} className="w-full">
      {loading ? 'Signing in…' : 'Sign in with GitHub'}
    </Button>
  );
}
