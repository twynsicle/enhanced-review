import { Grid, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { PullMetadata, PullReviewer } from '@/domain/github/types';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@/domain/review/narrative';
import type { ReviewTarget } from '@/domain/review/target';
import { LeadMarkdown } from '@/web/components/narrative/lead-markdown';
import { MarkdownText } from '@/web/components/narrative/markdown-text';
import { type AiReviewerData, PeopleCard } from '@/web/components/narrative/people-card';
import { RiskSummaryPanel, type RiskSummaryStat } from '@/web/components/narrative/risk-score';
import { token } from '@/web/theme/tokens';

const CAPTION = { fz: 10.5, fw: 500, tt: 'uppercase', style: { letterSpacing: '0.16em' } } as const;

/**
 * The synthesised summary section: title line, risk panel + people card,
 * the reviewer's overview and, when GitHub answered, the author's own PR
 * description. `pullMetadata` is null when the viewer cannot reach GitHub;
 * the card then falls back to what the job already knows.
 */
export function SummaryCard({
  review,
  target,
  pullMetadata,
  reviewers,
  aiReviewer,
  byline,
  actions,
}: {
  review: NarrativeReview;
  target: ReviewTarget;
  pullMetadata: PullMetadata | null;
  reviewers: PullReviewer[];
  aiReviewer: AiReviewerData;
  /** Job-level byline used when GitHub metadata is not available. */
  byline: { author: string; sha: string };
  /** Header action (the rerun button). */
  actions?: ReactNode;
}) {
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
  const insightCount = review.chapters.reduce((sum, ch) => sum + ch.insights.length, 0);

  const stats: RiskSummaryStat[] = [
    { label: 'Files', value: reviewedFileCount, sub: `+${additions} / -${deletions}` },
    {
      label: 'Chapters',
      value: review.chapters.length,
      sub: `${insightCount} ${insightCount === 1 ? 'insight' : 'insights'}`,
    },
  ];

  const prNumber = target.kind === 'pr' ? target.number : null;
  const dot = (
    <Text component="span" fz="inherit" aria-hidden>
      ·
    </Text>
  );

  return (
    <Stack component="article" id={`chapter-${SUMMARY_SECTION_ID}`} gap={28}>
      <Stack component="header" gap={12}>
        <Group justify="space-between" align="flex-start" gap={12} wrap="nowrap">
          <Text
            fz={11}
            fw={500}
            tt="uppercase"
            c={token('before')}
            style={{ letterSpacing: '0.18em' }}
          >
            Review&nbsp;&nbsp;·&nbsp;&nbsp;Summary
          </Text>
          {actions}
        </Group>
        <Title
          order={1}
          id={`chapter-heading-${SUMMARY_SECTION_ID}`}
          tabIndex={-1}
          fz={42}
          fw={600}
          lh={1.05}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {title}
        </Title>
        <Group gap={12} fz={13} c="dimmed" style={{ rowGap: 4 }}>
          <Text component="span" ff="monospace" fz={12.5}>
            {target.owner}/{target.repo}
          </Text>
          {prNumber !== null && (
            <>
              {dot}
              <Text component="span" ff="monospace" fz={12.5}>
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
                fz={12.5}
              >
                <span>{headRef}</span>
                <span aria-hidden>→</span>
                <span>{baseRef}</span>
              </Group>
            </>
          )}
          {dot}
          <Text
            component="code"
            ff="monospace"
            fz={11}
            px={6}
            py={2}
            style={{ borderRadius: 4, background: token('muted') }}
          >
            {sha}
          </Text>
        </Group>
      </Stack>

      <Grid gap={16}>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <RiskSummaryPanel assessment={review.riskAssessment} stats={stats} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <PeopleCard
            author={{ login: author, avatarUrl: authorAvatar }}
            reviewers={reviewers}
            aiReviewer={aiReviewer}
          />
        </Grid.Col>
      </Grid>

      <Stack component="section" gap={12}>
        <Title order={3} ff="text" {...CAPTION} c={token('subtle')}>
          Description
        </Title>
        <LeadMarkdown text={review.overviewSummary} />
      </Stack>

      {!review.riskAssessment && reviewedFileCount > 0 && (
        <Text fz={13} c="dimmed">
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
          <Title
            order={3}
            ff="text"
            {...CAPTION}
            c={token('subtle')}
            style={{ letterSpacing: '0.18em' }}
          >
            Author description
          </Title>
          <MarkdownText text={pullMetadata.body} />
        </Stack>
      )}
    </Stack>
  );
}
