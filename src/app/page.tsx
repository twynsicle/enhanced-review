import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { RecentReviews } from '@/components/home/recent-reviews';
import { ReviewComposer } from '@/components/home/review-composer';
import { Topbar } from '@/components/topbar/topbar';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { pbServer } from '@/lib/pb';
import type { UserRecord } from '@/lib/pb';

export const metadata = {
  title: 'enhanced-review',
};

export default async function Home() {
  const pb = await pbServer();
  const user = pb.authStore.isValid ? (pb.authStore.record as UserRecord | null) : null;
  if (!user) redirect('/login');

  const login = getGithubLogin(user) ?? user.email ?? user.id;
  const avatarUrl =
    user.avatar && user.avatar.length > 0 ? pb.files.getURL(user, user.avatar) : null;
  const fullName = user.name && user.name.length > 0 ? user.name : null;

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
