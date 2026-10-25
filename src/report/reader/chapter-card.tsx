import { Box, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { plural } from '@/review/plural';
import type {
  DiffChunk,
  Insight,
  JudgementCall,
  NarrativeChapter,
  OverviewStyle,
  OverviewStyles,
} from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { isTestFile } from '@/review/test-file';
import { Caption } from '@/report/chrome/caption';
import classes from '@/report/reader/article.module.css';
import { AskClaudeCode } from '@/report/reader/ask-claude-code';
import { askPrompt } from '@/report/reader/ask-prompt';
import { ContextExcerptCard } from '@/report/reader/context-excerpt';
import { useReviewFiles } from '@/report/reader/file-source';
import { InlineDiffChunk } from '@/report/reader/inline-diff-chunk';
import { DiagramFigure } from '@/report/diagram/diagram-figure';
import { InsightCallout } from '@/report/reader/insight-callout';
import { MarkdownText } from '@/report/reader/markdown-text';
import { OverviewStyleTabs } from '@/report/reader/overview-style-tabs';
import { chapterMinutes, formatMinutes } from '@/report/reader/reading-time';
import { sectionCardId, sectionHeadingId } from '@/report/reader/sections';
import { DISPLAY_SIZE, token } from '@/report/theme/tokens';

const ORDINALS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

function chapterEyebrow(index: number): string {
  return `Chapter ${ORDINALS[index] ?? `#${index}`}`;
}

/**
 * Insights that name a file, keyed by it. An insight only reaches here with a
 * path the chapter cites — `parse-narrative.ts` drops any other anchor — so
 * every key has a diff card to land on.
 */
export function groupInsightsByFile(insights: readonly Insight[]): {
  anchored: Map<string, Insight[]>;
  unanchored: Insight[];
} {
  const anchored = new Map<string, Insight[]>();
  const unanchored: Insight[] = [];
  for (const insight of insights) {
    if (insight.filename === undefined) {
      unanchored.push(insight);
      continue;
    }
    const existing = anchored.get(insight.filename);
    if (existing) existing.push(insight);
    else anchored.set(insight.filename, [insight]);
  }
  return { anchored, unanchored };
}

/** Non-test files first, so a reviewer reads the change before its tests; stable within each group. */
export function orderChunksTestsLast(chunks: readonly DiffChunk[]): DiffChunk[] {
  return chunks
    .map((chunk, index) => ({ chunk, index }))
    .toSorted((a, b) => {
      const rank = Number(isTestFile(a.chunk.filename)) - Number(isTestFile(b.chunk.filename));
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(({ chunk }) => chunk);
}

/** Ruled section header: small-caps label on the left, a mono count on the right. */
export function SectionRule({ label, count }: { label: string; count: number }) {
  return (
    <Group
      component="header"
      justify="space-between"
      align="baseline"
      pb={8}
      style={{ borderBottom: `1px solid ${token('border')}` }}
    >
      <Caption>{label}</Caption>
      <Text component="span" ff="monospace" fz="xs" c="dimmed">
        {count}
      </Text>
    </Group>
  );
}

/** One chapter as an article: eyebrow, title, passage, insights grid, files. */
export function ChapterCard({
  chapter,
  styles,
  bodyStyle,
  meta,
  chapterIndex,
  judgementCalls,
  onSelectFile,
  footer,
}: {
  chapter: NarrativeChapter;
  /** The styles the review was written in, offered as tabs over the body. */
  styles: OverviewStyles;
  /** Which of the chapter's bodies is read, and so timed. */
  bodyStyle: OverviewStyle;
  /** Where the review came from, which the Ask button's prompt names. */
  meta: ReviewMeta;
  /** 1-based index for the eyebrow ("Chapter Two"). */
  chapterIndex: number;
  /**
   * The review's judgement calls this chapter draws, keyed by the file each
   * sits on. Review-wide rather than the chapter's own, since a question
   * belongs to a decision and is anchored to a file rather than to a chapter.
   */
  judgementCalls?: ReadonlyMap<string, JudgementCall[]>;
  /** Threaded down so a grounded diagram node can open its file. */
  onSelectFile?: (filename: string) => void;
  /** Drawn after everything else: where the reader goes next. */
  footer?: ReactNode;
}) {
  const fileCount = chapter.diffChunks.length;
  const insightCount = chapter.insights.length;
  const body = chapter.bodies?.[bodyStyle];
  const hasBodies = Object.keys(chapter.bodies ?? {}).length > 0;
  const excerpts = chapter.contextExcerpts ?? [];
  const { anchored, unanchored } = groupInsightsByFile(chapter.insights);
  const reviewFiles = useReviewFiles();
  return (
    <article
      className={classes.article}
      id={sectionCardId(chapter.id)}
      aria-labelledby={sectionHeadingId(chapter.id)}
    >
      {/*
       * Bled past the measure: a headline is a sentence at display size, and
       * held to the prose's width it wraps to three or four lines.
       */}
      <Stack component="header" gap={12} data-bleed>
        <AskClaudeCode
          key={chapter.id}
          prompt={askPrompt(meta, chapter, reviewFiles)}
          label={<Caption tone="before">{chapterEyebrow(chapterIndex)}</Caption>}
        />
        {/*
         * Headed by its headline, not its title: the title is a label for the
         * lists that point here, and on arriving the reader wants the sentence
         * saying what the chapter's change does.
         */}
        <Title
          order={1}
          id={sectionHeadingId(chapter.id)}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none', textWrap: 'pretty' }}
        >
          {chapter.headline}
        </Title>
        <Text fz="sm" c="dimmed">
          {plural(fileCount, 'file')} touched · {plural(insightCount, 'insight')} ·{' '}
          {formatMinutes(chapterMinutes(chapter, bodyStyle))}
        </Text>
      </Stack>

      {/*
       * Tabs only over a chapter written with a body: a "Headlines only" tab
       * over nothing in every style would offer a choice with no difference.
       */}
      {hasBodies && (
        <OverviewStyleTabs styles={styles} shown={bodyStyle}>
          {body && (
            <Box style={{ textWrap: 'pretty' }}>
              <MarkdownText text={body} />
            </Box>
          )}
        </OverviewStyleTabs>
      )}

      {/*
       * Orientation before detail: the diagram sits between the passage and
       * the insights, because it answers "what shape is this" and the insights
       * answer "what should I look at". It bleeds past the measure for the
       * same reason a diff does.
       */}
      {chapter.diagram && (
        <DiagramFigure diagram={chapter.diagram} {...(onSelectFile ? { onSelectFile } : {})} />
      )}

      {/*
       * Only the insights that are about the chapter rather than about one
       * file. An anchored one is drawn on its diff below, where its subject
       * is; hoisting it here as well would say the same thing twice, once too
       * early.
       */}
      {unanchored.length > 0 && (
        <Stack component="section" gap={16}>
          <SectionRule label="Insights" count={unanchored.length} />
          {/*
           * One column, not two. At the reading measure a two-up grid gave
           * each callout ~328px, and widening the grid alone would have put a
           * third edge on the page — cards ending somewhere between where the
           * prose ends and where the diffs do. A full-measure card is also
           * shorter than a half-measure one, so stacking costs far less height
           * than the doubled count suggests.
           */}
          <Stack gap={16}>
            {unanchored.map((insight, i) => (
              <InsightCallout key={i} insight={insight} />
            ))}
          </Stack>
        </Stack>
      )}

      {/*
       * The one thing here that earns the extra width. Diffs are the reason
       * the wide-layout toggle exists, so they span past the reading measure
       * while every block above them keeps it.
       */}
      {fileCount > 0 && (
        <Stack component="section" gap={20} data-bleed>
          <SectionRule label="Files in this chapter" count={fileCount} />
          {orderChunksTestsLast(chapter.diffChunks).map((chunk, i) => (
            <InlineDiffChunk
              key={`${chunk.filename}-${i}`}
              chunk={chunk}
              insights={anchored.get(chunk.filename) ?? []}
              judgementCalls={judgementCalls?.get(chunk.filename) ?? []}
            />
          ))}
        </Stack>
      )}

      {/*
       * After the diffs, never among them: the reader meets what changed before
       * what it reaches, and a card that is not a changed file is not counted
       * as one above.
       */}
      {excerpts.length > 0 && (
        <Stack component="section" gap={20} data-bleed>
          <SectionRule label="Unchanged code it affects" count={excerpts.length} />
          {excerpts.map((excerpt, i) => (
            <ContextExcerptCard
              key={`${excerpt.filename}-${String(i)}`}
              excerpt={excerpt}
              modelKey={`${chapter.id}-${String(i)}`}
            />
          ))}
        </Stack>
      )}

      {footer}
    </article>
  );
}
