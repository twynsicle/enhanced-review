import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';

export const metadata = {
  title: 'enhanced-review',
};

/**
 * Phase 1 placeholder home. The proxy gate already guarantees an
 * authenticated, allowlisted user reaches this page; we re-fetch the user
 * here just to render their identity.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense-in-depth: shouldn't happen because proxy.ts redirects, but if
  // someone bypasses (e.g. proxy matcher misconfig), don't show a half-rendered
  // logged-in view.
  if (!user) redirect('/login');

  const login = getGithubLogin(user) ?? user.email ?? user.id;
  const meta = user.user_metadata as Record<string, unknown> | null | undefined;
  const avatarUrl = typeof meta?.avatar_url === 'string' ? (meta.avatar_url as string) : null;
  const fullName = typeof meta?.full_name === 'string' ? (meta.full_name as string) : null;

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center gap-4 space-y-0">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={`${login} avatar`}
              width={56}
              height={56}
              className="rounded-full"
            />
          ) : (
            <div className="size-14 rounded-full bg-muted" aria-hidden />
          )}
          <div className="flex flex-col">
            <CardTitle>{fullName ?? login}</CardTitle>
            <CardDescription>@{login}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in. Phase 1 ends here — repo and PR pickers land in Phase 2.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
