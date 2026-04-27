import type { ReactNode } from 'react';
import type { NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { PullMetadata, PullReviewer } from '@/lib/github/view-time';
import { LeadMarkdown } from './lead-markdown';
import { MarkdownText } from './markdown-text';
import { type AiReviewerData, PeopleCard } from './people-card';
import { RiskSummaryPanel, type RiskSummaryStat } from './risk-score';

interface SummaryCardProps {
  review: NarrativeReview;
  target: ReviewTarget;
  /**
   * PR or branch metadata fetched at view time. `null` when the viewer
   * doesn't have access to the repo (or the fetch failed) — the card
   * falls back to the data already on `target`.
   */
  pullMetadata: PullMetadata | null;
  reviewers: PullReviewer[];
  aiReviewer: AiReviewerData;
  /** Job-level byline used when GH metadata isn't available. */
  byline: { author: string; sha: string };
  /** Action node placed in the header (e.g. RerunButton). */
  actions?: ReactNode;
}

export function SummaryCard({
  review,
  target,
  pullMetadata,
  reviewers,
  aiReviewer,
  byline,
  actions,
}: SummaryCardProps) {
  const baseRef = pullMetadata?.baseRefName ?? (target.kind === 'branch' ? target.baseRef : null);
  const headRef = pullMetadata?.headRefName ?? (target.kind === 'branch' ? target.ref : null);
  const author = pullMetadata?.authorLogin ?? byline.author;
  const authorAvatar =
    pullMetadata?.authorAvatarUrl ?? `https://github.com/${byline.author}.png?size=64`;
  const title =
    review.prTitle || pullMetadata?.title || (target.kind === 'pr' ? target.title : target.ref);
  const sha = byline.sha.slice(0, 7);
  const reviewedFiles = review.files ?? [];
  const reviewedFileCount = reviewedFiles.length || pullMetadata?.changedFiles || 0;
  const additions =
    reviewedFiles.length > 0
      ? reviewedFiles.reduce((sum, file) => sum + file.additions, 0)
      : (pullMetadata?.additions ?? 0);
  const deletions =
    reviewedFiles.length > 0
      ? reviewedFiles.reduce((sum, file) => sum + file.deletions, 0)
      : (pullMetadata?.deletions ?? 0);

  const fileWord = reviewedFileCount === 1 ? 'file' : 'files';
  const insightCount = review.chapters.reduce((sum, ch) => sum + ch.insights.length, 0);
  const insightWord = insightCount === 1 ? 'insight' : 'insights';

  const stats: RiskSummaryStat[] = [
    {
      label: 'Files',
      value: reviewedFileCount,
      sub: `+${String(additions)} / -${String(deletions)}`,
    },
    {
      label: 'Chapters',
      value: review.chapters.length,
      sub: `${String(insightCount)} ${insightWord}`,
    },
  ];

  const prNumber = target.kind === 'pr' ? target.number : null;

  return (
    <article id="chapter-__summary__" className="flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">
            Review&nbsp;&nbsp;·&nbsp;&nbsp;Summary
          </p>
          {actions}
        </div>
        <h1
          id="chapter-heading-__summary__"
          tabIndex={-1}
          className="font-serif text-[42px] font-semibold leading-[1.05] tracking-[-0.02em] outline-none"
        >
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="font-mono text-[12.5px]">
            {target.owner}/{target.repo}
          </span>
          {prNumber !== null && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono text-[12.5px]">PR #{String(prNumber)}</span>
            </>
          )}
          {headRef && baseRef && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]">
                <span>{headRef}</span>
                <span aria-hidden>→</span>
                <span>{baseRef}</span>
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{sha}</code>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RiskSummaryPanel assessment={review.riskAssessment} stats={stats} />
        <PeopleCard
          author={{ login: author, avatarUrl: authorAvatar }}
          reviewers={reviewers}
          aiReviewer={aiReviewer}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-subtle">
          Description
        </h3>
        <LeadMarkdown text={review.overviewSummary} />
      </section>

      {!review.riskAssessment && reviewedFileCount > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {reviewedFileCount} {fileWord} · <span className="text-add">+{additions}</span>{' '}
          <span className="text-del">−{deletions}</span>
        </p>
      )}

      {pullMetadata?.body && (
        <section className="flex flex-col gap-2 border-t border-border pt-5">
          <h3 className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
            Author description
          </h3>
          <MarkdownText text={pullMetadata.body} />
        </section>
      )}
    </article>
  );
}
