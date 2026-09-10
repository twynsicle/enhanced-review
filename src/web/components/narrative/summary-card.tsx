import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { PullMetadata } from '@/domain/github/types';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@/domain/review/narrative';
import type { ReviewTarget } from '@/domain/review/target';
import { Caption } from '@/web/components/caption';
import classes from '@/web/components/narrative/article.module.css';
import { LeadMarkdown } from '@/web/components/narrative/lead-markdown';
import { MarkdownText } from '@/web/components/narrative/markdown-text';
import { RiskSummaryPanel } from '@/web/components/narrative/risk-score';
import { DISPLAY_SIZE, token } from '@/web/theme/tokens';

/**
 * The synthesised summary section: title line, risk panel, the reviewer's
 * overview and, when GitHub answered, the author's own PR description.
 * `pullMetadata` is null when the viewer cannot reach GitHub; the card then
 * falls back to what the job already knows.
 */
export function SummaryCard({
  review,
  target,
  pullMetadata,
  byline,
  actions,
}: {
  review: NarrativeReview;
  target: ReviewTarget;
  pullMetadata: PullMetadata | null;
  /** Job-level byline used when GitHub metadata is not available. */
  byline: { author: string };
  /** Header action (the rerun button). */
  actions?: ReactNode;
}) {
  const baseRef = pullMetadata?.baseRefName ?? (target.kind === 'branch' ? target.baseRef : null);
  const headRef = pullMetadata?.headRefName ?? (target.kind === 'branch' ? target.ref : null);
  const author = pullMetadata?.authorLogin ?? byline.author;
  const title =
    review.prTitle || pullMetadata?.title || (target.kind === 'pr' ? target.title : target.ref);
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

  const prNumber = target.kind === 'pr' ? target.number : null;
  const dot = (
    <Text component="span" fz="inherit" aria-hidden>
      ·
    </Text>
  );

  return (
    <article className={classes.article} id={`chapter-${SUMMARY_SECTION_ID}`}>
      <Stack component="header" gap={12}>
        <Group justify="space-between" align="flex-start" gap={12} wrap="nowrap">
          <Caption tone="before">Summary</Caption>
          {actions}
        </Group>
        <Title
          order={1}
          id={`chapter-heading-${SUMMARY_SECTION_ID}`}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {title}
        </Title>
        {/*
         * Where this review came from, and nothing else. The reviewed commit
         * SHA used to sit here too, but a seven-character hash tells the reader
         * nothing about the change and the staleness banner is what actually
         * needs to reason about commits.
         */}
        <Group gap={12} fz="sm" c="dimmed" style={{ rowGap: 4 }}>
          <Text component="span" ff="monospace" fz="inherit">
            {target.owner}/{target.repo}
          </Text>
          {prNumber !== null && (
            <>
              {dot}
              <Text component="span" ff="monospace" fz="inherit">
                PR #{prNumber}
              </Text>
            </>
          )}
          {headRef && baseRef && (
            <>
              {dot}
              <Group
                component="span"
                gap={6}
                wrap="nowrap"
                display="inline-flex"
                ff="monospace"
                fz="inherit"
              >
                <span>{headRef}</span>
                <span aria-hidden>→</span>
                <span>{baseRef}</span>
              </Group>
            </>
          )}
          {dot}
          <Text component="span" fz="inherit">
            @{author}
          </Text>
        </Group>
      </Stack>

      <RiskSummaryPanel assessment={review.riskAssessment} />

      <Stack component="section" gap={12}>
        <Caption component="h3">Review summary</Caption>
        <LeadMarkdown text={review.overviewSummary} />
      </Stack>

      {!review.riskAssessment && reviewedFileCount > 0 && (
        <Text fz="sm" c="dimmed">
          {reviewedFileCount} {reviewedFileCount === 1 ? 'file' : 'files'} ·{' '}
          <Text component="span" fz="inherit" c={token('add')}>
            +{additions}
          </Text>{' '}
          <Text component="span" fz="inherit" c={token('del')}>
            −{deletions}
          </Text>
        </Text>
      )}

      {pullMetadata?.body && (
        <Stack
          component="section"
          gap={8}
          pt={20}
          style={{ borderTop: `1px solid ${token('border')}` }}
        >
          <Caption component="h3">Author&rsquo;s description</Caption>
          <MarkdownText text={pullMetadata.body} />
        </Stack>
      )}
    </article>
  );
}
