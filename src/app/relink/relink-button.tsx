'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

/**
 * Re-runs the GitHub OAuth flow with the same `repo` scope. Supabase
 * Auth re-issues the session (and a fresh `provider_token`) on the
 * callback redirect.
 */
export function RelinkButton() {
  const [loading, setLoading] = useState(false);

  async function relink() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        scopes: 'repo',
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      console.error('[relink] OAuth init failed', error);
      setLoading(false);
    }
  }

  return (
    <Button onClick={relink} disabled={loading} className="w-full">
      {loading ? 'Redirecting…' : 'Re-link GitHub'}
    </Button>
  );
}
