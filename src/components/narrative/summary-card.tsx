import type { NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { PullMetadata } from '@/lib/github/view-time';
import { MarkdownText } from './markdown-text';

interface SummaryCardProps {
  review: NarrativeReview;
  target: ReviewTarget;
  /**
   * PR or branch metadata fetched at view time. `null` when the viewer
   * doesn't have access to the repo (or the fetch failed) — the card
   * falls back to the data already on `target`.
   */
  pullMetadata: PullMetadata | null;
}

export function SummaryCard({ review, target, pullMetadata }: SummaryCardProps) {
  const baseRef = pullMetadata?.baseRefName ?? (target.kind === 'branch' ? target.baseRef : null);
  const headRef =
    pullMetadata?.headRefName ?? (target.kind === 'branch' ? target.ref : null);
  const author = pullMetadata?.authorLogin;
  const authorAvatar = pullMetadata?.authorAvatarUrl;

  return (
    <article id="chapter-__summary__" className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1
          id="chapter-heading-__summary__"
          tabIndex={-1}
          className="text-2xl font-semibold leading-tight outline-none"
        >
          {review.prTitle || pullMetadata?.title || (target.kind === 'pr' ? target.title : target.ref)}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {author && (
            <span className="inline-flex items-center gap-1.5">
              {authorAvatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={authorAvatar}
                  alt=""
                  className="size-4 rounded-full"
                  width={16}
                  height={16}
                />
              )}
              <span>@{author}</span>
            </span>
          )}
          {baseRef && headRef && (
            <span className="inline-flex items-center gap-1.5 font-mono">
              <code className="rounded bg-muted px-1.5 py-0.5">{baseRef}</code>
              <span aria-hidden>←</span>
              <code className="rounded bg-muted px-1.5 py-0.5">{headRef}</code>
            </span>
          )}
        </div>
        {pullMetadata && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{pullMetadata.changedFiles} files</span>
            <span className="text-emerald-600 dark:text-emerald-400">+{pullMetadata.additions}</span>
            <span className="text-rose-600 dark:text-rose-400">−{pullMetadata.deletions}</span>
          </div>
        )}
      </header>

      {pullMetadata?.body && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </h3>
          <MarkdownText text={pullMetadata.body} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          AI Overview
        </h3>
        <MarkdownText text={review.overviewSummary} />
      </section>
    </article>
  );
}
