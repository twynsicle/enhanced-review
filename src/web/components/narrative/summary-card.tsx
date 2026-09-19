import { Box, Collapse, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import type { Finding } from '@/domain/review/findings';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@/domain/review/narrative';
import type { ReviewMeta } from '@/domain/review/review-meta';
import { Caption } from '@/web/components/caption';
import classes from '@/web/components/narrative/article.module.css';
import { DiagramFigure } from '@/web/components/narrative/diagram/diagram-figure';
import { FindingsNotice } from '@/web/components/narrative/findings-notice';
import type { AnchoredJudgementCall } from '@/web/components/narrative/judgement-calls';
import { MarkdownText } from '@/web/components/narrative/markdown-text';
import { ProsePassage } from '@/web/components/narrative/prose-passage';
import { sectionCardId, sectionHeadingId } from '@/web/components/narrative/sections';
import { token } from '@/web/theme/tokens';
import { DISPLAY_SIZE } from '@/web/theme/tokens';

/**
 * The synthesised summary section: title line, the overview diagram, the
 * reviewer's overview and, when there is one, the author's own PR
 * description.
 *
 * The risk rating used to sit between the title and the overview, which made
 * this section three unrelated things in one scroll — a rating, a synthesis
 * and someone else's prose. Risk is its own section now, and what is left
 * here reads in one direction: what changed, shown, then said.
 *
 * Where the review came from arrives as one `ReviewMeta`, built by whoever
 * hosts the reader: the hosted route from the job and GitHub, a local report
 * from git. The card only decides what to show when a field is missing.
 */
export function SummaryCard({
  review,
  meta,
  findings,
  judgementCalls = [],
  actions,
  onSelectFile,
  onSelectChapter,
}: {
  review: NarrativeReview;
  meta: ReviewMeta;
  /** What validating this review found; empty in the local report, which carries none. */
  findings: readonly Finding[];
  /** The review's questions and the chapter each is drawn in. */
  judgementCalls?: readonly AnchoredJudgementCall[];
  /** Header action (the hosted app's rerun button). */
  actions?: ReactNode;
  /** Threaded down so a grounded diagram node can open its file. */
  onSelectFile?: (filename: string) => void;
  /** How a judgement call in the index reaches the chapter that draws it. */
  onSelectChapter?: (chapterId: string) => void;
}) {
  const { baseRefName: baseRef, headRefName: headRef, authorLogin: author, prNumber } = meta;
  const title = review.prTitle || meta.title;
  const reviewedFiles = review.files ?? [];
  const reviewedFileCount = reviewedFiles.length || meta.stats?.changedFiles || 0;
  const additions =
    reviewedFiles.length > 0
      ? reviewedFiles.reduce((sum, file) => sum + file.additions, 0)
      : (meta.stats?.additions ?? 0);
  const deletions =
    reviewedFiles.length > 0
      ? reviewedFiles.reduce((sum, file) => sum + file.deletions, 0)
      : (meta.stats?.deletions ?? 0);

  const dot = (
    <Text component="span" fz="inherit" aria-hidden>
      ·
    </Text>
  );

  return (
    <article className={classes.article} id={sectionCardId(SUMMARY_SECTION_ID)}>
      <Stack component="header" gap={12}>
        <Group justify="space-between" align="flex-start" gap={12} wrap="nowrap">
          <Caption tone="before">Summary</Caption>
          {actions}
        </Group>
        <Title
          order={1}
          id={sectionHeadingId(SUMMARY_SECTION_ID)}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {title}
        </Title>
        {/*
         * Where this review came from, and how big it is. The reviewed commit
         * SHA used to sit here too, but a seven-character hash tells the reader
         * nothing about the change and the staleness banner is what actually
         * needs to reason about commits. The file and line counts used to
         * appear only when there was no risk rating to crowd them out; with
         * risk gone they belong here, with the rest of the provenance.
         */}
        <Group gap={12} fz="sm" c="dimmed" style={{ rowGap: 4 }}>
          <Text component="span" ff="monospace" fz="inherit">
            {meta.repo}
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
          {author && (
            <>
              {dot}
              <Text component="span" fz="inherit">
                @{author}
              </Text>
            </>
          )}
          {reviewedFileCount > 0 && (
            <>
              {dot}
              <Text component="span" fz="inherit">
                {reviewedFileCount} {reviewedFileCount === 1 ? 'file' : 'files'}
              </Text>
              <Text component="span" fz="inherit" c={token('add')}>
                +{additions}
              </Text>
              <Text component="span" fz="inherit" c={token('del')}>
                −{deletions}
              </Text>
            </>
          )}
        </Group>
      </Stack>

      <FindingsNotice findings={findings} />

      <Stack component="section" gap={12}>
        <Caption component="h3">Review summary</Caption>
        <ProsePassage prose={review.overviewSummary} />
      </Stack>

      {review.overviewDiagram && (
        <DiagramFigure
          diagram={review.overviewDiagram}
          {...(onSelectFile ? { onSelectFile } : {})}
        />
      )}

      {judgementCalls.length > 0 && onSelectChapter && (
        <JudgementCallIndex anchored={judgementCalls} onSelectChapter={onSelectChapter} />
      )}

      {meta.description && <AuthorDescription body={meta.description} />}
    </article>
  );
}

/**
 * The review's judgement calls as an index, not as the questions themselves.
 *
 * Each one is drawn in full beside the lines that raised it, which is the only
 * place it can be answered — but the reader sees one section at a time, so a
 * question in the seventh chapter is a question nobody meets. A title and a
 * link cost the summary four lines at most and make the set visible from the
 * top, while the question itself stays where its evidence is.
 */
function JudgementCallIndex({
  anchored,
  onSelectChapter,
}: {
  anchored: readonly AnchoredJudgementCall[];
  onSelectChapter: (chapterId: string) => void;
}) {
  return (
    <Stack component="section" gap={12}>
      <Caption component="h3" tone="suggestion">
        Judgement calls
      </Caption>
      <Text fz="sm" c="dimmed">
        {anchored.length === 1
          ? 'One decision here needs context the code does not carry.'
          : `${String(anchored.length)} decisions here need context the code does not carry.`}
      </Text>
      <Stack component="ol" gap={8} m={0} pl={0} style={{ listStyle: 'none' }}>
        {anchored.map((entry, i) => (
          <Box component="li" key={`${entry.chapterId}-${String(i)}`}>
            <UnstyledButton
              fz="md"
              ta="left"
              onClick={() => onSelectChapter(entry.chapterId)}
              style={{ textWrap: 'pretty', textDecoration: 'underline' }}
            >
              {entry.call.title}
            </UnstyledButton>
            <Text fz="sm" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all' }}>
              {entry.call.filename}
            </Text>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

/**
 * The author's own PR description, collapsed.
 *
 * It is worth having for completeness, but it is not what this page is for
 * and the reader has already seen it on GitHub. Open it used to be the last
 * thing between the summary and the bottom of a long scroll; closed, it is a
 * line.
 */
function AuthorDescription({ body }: { body: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Stack
      component="section"
      gap={8}
      pt={20}
      style={{ borderTop: `1px solid ${token('border')}` }}
    >
      <UnstyledButton
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        c="dimmed"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <Box
          component="span"
          aria-hidden
          style={{
            display: 'inline-block',
            transition: 'transform 120ms',
            transform: open ? 'rotate(90deg)' : undefined,
          }}
        >
          ▸
        </Box>
        <Caption component="h3">Author&rsquo;s description</Caption>
      </UnstyledButton>
      <Collapse expanded={open}>
        <MarkdownText text={body} />
      </Collapse>
    </Stack>
  );
}
