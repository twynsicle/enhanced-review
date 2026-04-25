import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { SignInButton } from './sign-in-button';

export const metadata = {
  title: 'Sign in — enhanced-review',
};

/**
 * The proxy already redirects authenticated users away from /login, but we
 * double-check here so a stale tab can't keep showing the sign-in screen
 * after a session is established server-side.
 */
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/');

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            enhanced-review is invite-only during the beta. Sign in with the GitHub account
            that&apos;s been added to the allowlist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInButton />
        </CardContent>
      </Card>
    </main>
  );
}
