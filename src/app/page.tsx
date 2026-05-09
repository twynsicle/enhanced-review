import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { RecentReviews } from '@/components/home/recent-reviews';
import { ReviewComposer } from '@/components/home/review-composer';
import { Topbar } from '@/components/topbar/topbar';
import { auth } from '@/lib/auth/auth';

export const metadata = {
  title: 'enhanced-review',
};

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const login = session.user.githubLogin ?? session.user.email ?? session.user.id;
  const avatarUrl = session.user.image ?? null;
  const fullName = session.user.name && session.user.name.length > 0 ? session.user.name : null;

  return (
    <>
      <Topbar user={{ login, fullName, avatarUrl }} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-5 py-12 sm:px-7 sm:py-14">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">
              ❖&nbsp;&nbsp;A new review
            </p>
            <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[44px]">
              The reviewer is ready when you are.
            </h1>
            <p className="max-w-[58ch] text-[15px] leading-[1.55] text-muted-foreground text-pretty">
              Choose a pull request or branch — we&rsquo;ll read every line, write the chapters, and
              surface the few things that genuinely need a human eye.
            </p>
          </div>
          <ReviewComposer userId={session.user.id} />
        </section>
        <Suspense fallback={null}>
          <RecentReviews />
        </Suspense>
      </main>
    </>
  );
}
