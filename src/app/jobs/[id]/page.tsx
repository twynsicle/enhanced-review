import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ReviewChunkRow, ReviewJobRow } from '@/lib/jobs/types';
import { JobLiveView } from './job-live-view';

/**
 * `/jobs/:id` — live view of a single review job.
 *
 * Server-rendered shell hydrates the page with the current job row + any
 * chunks already written; the client component then subscribes to
 * Supabase Realtime for updates. RLS allows any authenticated user to
 * SELECT here (workspace visibility), so two beta users can watch the
 * same job side-by-side.
 */
export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: job } = await supabase
    .from('review_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle<ReviewJobRow>();

  if (!job) notFound();

  const { data: chunks } = await supabase
    .from('review_chunks')
    .select('*')
    .eq('job_id', id)
    .order('seq', { ascending: true });

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <JobLiveView
        initialJob={job}
        initialChunks={(chunks ?? []) as ReviewChunkRow[]}
        viewerUserId={user.id}
      />
    </main>
  );
}
