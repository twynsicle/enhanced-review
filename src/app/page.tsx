import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { RecentReviews } from '@/components/home/recent-reviews';
import { ReviewComposer } from '@/components/home/review-composer';
import { Topbar } from '@/components/topbar/topbar';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'enhanced-review',
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const login = getGithubLogin(user) ?? user.email ?? user.id;
  const meta = user.user_metadata as Record<string, unknown> | null | undefined;
  const avatarUrl = typeof meta?.avatar_url === 'string' ? (meta.avatar_url as string) : null;
  const fullName = typeof meta?.full_name === 'string' ? (meta.full_name as string) : null;

  return (
    <>
      <Topbar user={{ login, fullName, avatarUrl }} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <ReviewComposer userId={user.id} />
        <Suspense fallback={null}>
          <RecentReviews />
        </Suspense>
      </main>
    </>
  );
}
