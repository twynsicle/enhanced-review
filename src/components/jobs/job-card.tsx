import { GitBranch, GitPullRequest } from 'lucide-react';
import Link from 'next/link';
import type { ReviewJobRow } from '@/lib/jobs/types';
import { timeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

/**
 * Single review-job card, used by `/history` and the homepage's
 * recent-reviews block. Done jobs deep-link to the rendered reader;
 * everything else lands on the live job view.
 */
export function JobCard({ job }: { job: ReviewJobRow }) {
  const href = job.status === 'done' ? `/reviews/${job.id}` : `/jobs/${job.id}`;
  const target = job.target;
  const repoSlug = `${target.owner}/${target.repo}`;
  const Icon = target.kind === 'pr' ? GitPullRequest : GitBranch;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-all hover:ring-foreground/25 hover:bg-card/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {target.kind === 'pr' ? (
                <>
                  <span className="text-muted-foreground tabular-nums">#{target.number}</span>{' '}
                  {target.title}
                </>
              ) : (
                <span className="font-mono">{target.ref}</span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{repoSlug}</p>
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {/* Avatar via github.com/{login}.png — public, browser-cached, no API call. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://github.com/${job.github_login}.png?size=32`}
          alt=""
          width={16}
          height={16}
          className="size-4 rounded-full"
          loading="lazy"
        />
        <span className="truncate">@{job.github_login}</span>
        <span aria-hidden>·</span>
        <span>{timeAgo(job.created_at)}</span>
        <span aria-hidden>·</span>
        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
          {job.head_sha.slice(0, 7)}
        </code>
      </div>
    </Link>
  );
}

const STATUS_STYLES: Record<ReviewJobRow['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-foreground/10 text-foreground',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: ReviewJobRow['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
