import { Group, Stack, Text, Title } from '@mantine/core';
import { plural } from '@/common/plural';
import type { DiffChunk, Insight, NarrativeChapter } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import classes from '@/web/components/narrative/article.module.css';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { DiagramFigure } from '@/web/components/narrative/diagram/diagram-figure';
import { InsightCallout } from '@/web/components/narrative/insight-callout';
import { ProsePassage } from '@/web/components/narrative/prose-passage';
import { sectionCardId, sectionHeadingId } from '@/web/components/narrative/sections';
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

const TEST_PATH_SEGMENT = /^(__tests__|tests?|specs?)$/i;

function isTestFile(filename: string): boolean {
  const segments = filename.split('/');
  const base = segments[segments.length - 1] ?? filename;
  return (
    /\.(test|spec)\.[^./]+$/i.test(base) ||
    /_test\.[^./]+$/i.test(base) ||
    /^test_/i.test(base) ||
    segments.some((segment) => TEST_PATH_SEGMENT.test(segment))
  );
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
  const { anchored, unanchored } = groupInsightsByFile(chapter.insights);
  return (
    <article
      className={classes.article}
      id={sectionCardId(chapter.id)}
      aria-labelledby={sectionHeadingId(chapter.id)}
    >
      <Stack component="header" gap={12}>
        <Caption tone="before">{chapterEyebrow(chapterIndex)}</Caption>
        <Title
          order={1}
          id={sectionHeadingId(chapter.id)}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {chapter.title}
        </Title>
        <Text fz="sm" c="dimmed">
          {plural(fileCount, 'file')} touched · {plural(insightCount, 'insight')}
        </Text>
      </Stack>

      {chapter.description && <ProsePassage prose={chapter.description} />}

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
            />
          ))}
        </Stack>
      )}
    </article>
  );
}
