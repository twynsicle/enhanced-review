import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { JobCard } from '@/components/jobs/job-card';
import type { ReviewJobRow } from '@/lib/jobs/types';
import { logger } from '@/lib/log';
import { createClient } from '@/lib/supabase/server';

const RECENT_LIMIT = 5;

export async function RecentReviews() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('review_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT)
    .returns<ReviewJobRow[]>();

  if (error) {
    logger.error({ err: error, user_id: user.id }, '[recent-reviews] fetch failed');
  }

  const jobs = data ?? [];

  return (
    <section aria-label="Recent reviews" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent reviews
        </h2>
        {jobs.length > 0 && (
          <Link
            href="/history"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View all <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-xl bg-card/50 p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/5">
          No reviews yet — pick a target above and start your first one.
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
