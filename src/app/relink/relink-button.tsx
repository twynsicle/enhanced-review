'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { pbBrowser } from '@/lib/pb/browser';

/**
 * Re-runs the GitHub OAuth flow with the same `repo` scope. Mirrors
 * SignInButton — same popup, same post-signin handshake — refreshes both
 * the PB session token and the `gh_access_token` cookie that the picker /
 * runner read.
 */
export function RelinkButton() {
  const [loading, setLoading] = useState(false);

  async function relink() {
    setLoading(true);
    try {
      const pb = pbBrowser();
      const authData = await pb.collection('users').authWithOAuth2({
        provider: 'github',
        scopes: ['repo'],
      });

      const meta = (authData.meta ?? {}) as {
        accessToken?: string;
        username?: string;
        name?: string;
        avatarURL?: string;
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
          avatarUrl: meta.avatarURL,
        }),
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`post-signin failed: ${res.status}`);
      }

      window.location.href = '/';
    } catch (error) {
      console.error('[relink] OAuth init failed', error);
      setLoading(false);
    }
  }

  return (
    <Button onClick={relink} disabled={loading} className="w-full">
      {loading ? 'Re-linking…' : 'Re-link GitHub'}
    </Button>
  );
}
