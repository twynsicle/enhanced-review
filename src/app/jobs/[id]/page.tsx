import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { Topbar } from '@/components/topbar/topbar';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db/client';
import { reviewChunks, reviewJobs } from '@/lib/db/schema';
import { toChunkRow, toJobRow } from '@/lib/jobs/types';
import { JobLiveView } from './job-live-view';

/**
 * `/jobs/:id` — live view of a single review job.
 *
 * Server-rendered shell hydrates the page with the current job row + any
 * chunks already written; the client component subscribes to the SSE
 * stream for updates (post-A5).
 */
export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const jobRows = await db.select().from(reviewJobs).where(eq(reviewJobs.id, id)).limit(1);
  if (jobRows.length === 0) notFound();
  const job = toJobRow(jobRows[0]);

  const chunkRows = await db
    .select()
    .from(reviewChunks)
    .where(eq(reviewChunks.jobId, id))
    .orderBy(asc(reviewChunks.seq));
  const chunks = chunkRows.map(toChunkRow);

  const login = session.user.githubLogin ?? session.user.email ?? session.user.id;
  const avatarUrl = session.user.image ?? null;
  const fullName = session.user.name && session.user.name.length > 0 ? session.user.name : null;

  return (
    <>
      <Topbar user={{ login, fullName, avatarUrl }} />
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-10 px-7 py-12">
        <JobLiveView initialJob={job} initialChunks={chunks} viewerUserId={session.user.id} />
      </main>
    </>
  );
}
