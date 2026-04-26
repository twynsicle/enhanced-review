import type { ReactNode } from 'react';
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
  /** Job-level byline used when GH metadata isn't available. */
  byline: { author: string; sha: string };
  /** Action node placed in the header (e.g. RerunButton). */
  actions?: ReactNode;
}

export function SummaryCard({ review, target, pullMetadata, byline, actions }: SummaryCardProps) {
  const baseRef = pullMetadata?.baseRefName ?? (target.kind === 'branch' ? target.baseRef : null);
  const headRef = pullMetadata?.headRefName ?? (target.kind === 'branch' ? target.ref : null);
  const author = pullMetadata?.authorLogin ?? byline.author;
  const authorAvatar =
    pullMetadata?.authorAvatarUrl ?? `https://github.com/${byline.author}.png?size=64`;
  const title =
    review.prTitle ||
    pullMetadata?.title ||
    (target.kind === 'pr' ? target.title : target.ref);
  const sha = byline.sha.slice(0, 7);

  const fileWord = pullMetadata?.changedFiles === 1 ? 'file' : 'files';

  return (
    <article id="chapter-__summary__" className="flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">
            ❖&nbsp;&nbsp;Summary
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
          <span className="inline-flex items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={authorAvatar}
              alt=""
              className="size-4 rounded-full"
              width={16}
              height={16}
              loading="lazy"
            />
            <span>@{author}</span>
          </span>
          <span aria-hidden>·</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{sha}</code>
          {pullMetadata && (
            <>
              <span aria-hidden>·</span>
              <span>
                {pullMetadata.changedFiles} {fileWord}
              </span>
              <span className="text-add">+{pullMetadata.additions}</span>
              <span className="text-del">−{pullMetadata.deletions}</span>
            </>
          )}
          {baseRef && headRef && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <code className="rounded bg-muted px-1.5 py-0.5">{headRef}</code>
                <span aria-hidden>→</span>
                <code className="rounded bg-muted px-1.5 py-0.5">{baseRef}</code>
              </span>
            </>
          )}
        </div>
      </header>

      <DropCapMarkdown text={review.overviewSummary} />

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

/**
 * Renders the AI overview as the editorial body — drop-cap on the first
 * paragraph, slightly muted on subsequent paragraphs to enforce
 * hierarchy. Falls back to plain MarkdownText when the overview is empty
 * or doesn't have a clean first-paragraph break.
 */
function DropCapMarkdown({ text }: { text: string }) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return (
      <p className="text-muted-foreground">No overview was generated for this review.</p>
    );
  }

  const firstBreak = trimmed.indexOf('\n\n');
  if (firstBreak === -1) {
    return (
      <div className="font-serif text-[18px] leading-[1.65]">
        <FirstParagraph text={trimmed} />
      </div>
    );
  }
  const first = trimmed.slice(0, firstBreak).trim();
  const rest = trimmed.slice(firstBreak).trim();

  return (
    <div className="font-serif text-[18px] leading-[1.65]">
      <FirstParagraph text={first} />
      {rest.length > 0 && (
        <div className="mt-5 text-[16px] text-muted-foreground">
          <MarkdownText text={rest} />
        </div>
      )}
    </div>
  );
}

function FirstParagraph({ text }: { text: string }) {
  // Render markdown content, then style the first letter via Tailwind.
  // We wrap MarkdownText in a div whose `:first-letter` selectors apply
  // to the leading character of the first child paragraph.
  return (
    <div className="prose-iris-dropcap text-pretty [&>:first-child]:first-letter:float-left [&>:first-child]:first-letter:mr-3 [&>:first-child]:first-letter:font-serif [&>:first-child]:first-letter:text-[64px] [&>:first-child]:first-letter:font-semibold [&>:first-child]:first-letter:leading-[0.9] [&>:first-child]:first-letter:text-iris">
      <MarkdownText text={text} />
    </div>
  );
}
