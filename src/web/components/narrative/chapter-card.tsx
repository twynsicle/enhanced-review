import { Group, Stack, Text, Title } from '@mantine/core';
import type { NarrativeChapter } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import classes from '@/web/components/narrative/article.module.css';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { DiagramFigure } from '@/web/components/narrative/diagram/diagram-figure';
import { InsightCallout } from '@/web/components/narrative/insight-callout';
import { LeadMarkdown } from '@/web/components/narrative/lead-markdown';
import { DISPLAY_SIZE, token } from '@/web/theme/tokens';

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
  chapterIndex,
  onSelectFile,
}: {
  chapter: NarrativeChapter;
  /** 1-based index for the eyebrow ("Chapter Two"). */
  chapterIndex: number;
  /** Threaded down so a grounded diagram node can open its file. */
  onSelectFile?: (filename: string) => void;
}) {
  const fileCount = chapter.diffChunks.length;
  const insightCount = chapter.insights.length;
  return (
    <article
      className={classes.article}
      id={`chapter-${chapter.id}`}
      aria-labelledby={`chapter-heading-${chapter.id}`}
    >
      <Stack component="header" gap={12}>
        <Caption tone="before">{chapterEyebrow(chapterIndex)}</Caption>
        <Title
          order={1}
          id={`chapter-heading-${chapter.id}`}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {chapter.title}
        </Title>
        <Text fz="sm" c="dimmed">
          {fileCount} file{fileCount === 1 ? '' : 's'} touched · {insightCount} insight
          {insightCount === 1 ? '' : 's'}
        </Text>
      </Stack>

      {chapter.description && chapter.description.trim().length > 0 && (
        <LeadMarkdown text={chapter.description} />
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

      {insightCount > 0 && (
        <Stack component="section" gap={16}>
          <SectionRule label="Insights" count={insightCount} />
          {/*
           * One column, not two. At the reading measure a two-up grid gave
           * each callout ~328px, and widening the grid alone would have put a
           * third edge on the page — cards ending somewhere between where the
           * prose ends and where the diffs do. A full-measure card is also
           * shorter than a half-measure one, so stacking costs far less height
           * than the doubled count suggests.
           */}
          <Stack gap={16}>
            {chapter.insights.map((insight, i) => (
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
          {chapter.diffChunks.map((chunk, i) => (
            <InlineDiffChunk key={`${chunk.filename}-${i}`} chunk={chunk} />
          ))}
        </Stack>
      )}
    </article>
  );
}
