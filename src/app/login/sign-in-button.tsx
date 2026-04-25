'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

export function SignInButton() {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        // `repo` covers public + private repo read access (Phase 2 picker
        // and Phase 4 worker need both). Existing pre-Phase-2 sessions
        // were issued without this scope and need to sign out + back in
        // to upgrade.
        scopes: 'repo',
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      console.error('[sign-in] OAuth init failed', error);
      setLoading(false);
    }
    // On success the browser navigates away to GitHub — no further action.
  }

  return (
    <Button onClick={signIn} disabled={loading} className="w-full">
      {loading ? 'Redirecting…' : 'Sign in with GitHub'}
    </Button>
  );
}
