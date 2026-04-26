import { notFound, redirect } from 'next/navigation';
import { getCurrentUser, pbServer } from '@/lib/pb';
import type { ReviewChunkRow, ReviewJobRow } from '@/lib/jobs/types';
import { JobLiveView } from './job-live-view';

/**
 * `/jobs/:id` — live view of a single review job.
 *
 * Server-rendered shell hydrates the page with the current job row + any
 * chunks already written; the client component then subscribes to
 * realtime for updates. PB rules allow any authenticated user to view
 * here (workspace visibility), so two beta users can watch the same job
 * side-by-side.
 */
export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const pb = await pbServer();

  let job: ReviewJobRow;
  try {
    job = await pb.collection('review_jobs').getOne<ReviewJobRow>(id);
  } catch {
    notFound();
  }

  const chunks = await pb
    .collection('review_chunks')
    .getFullList<ReviewChunkRow>({
      filter: `job = "${id}"`,
      sort: 'seq',
    })
    .catch(() => [] as ReviewChunkRow[]);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <JobLiveView initialJob={job} initialChunks={chunks} viewerUserId={user.id} />
    </main>
  );
}
