import { Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { NarrativeChapter } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
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
  owner,
  repo,
  baseRef,
  headRef,
}: {
  chapter: NarrativeChapter;
  /** 1-based index for the eyebrow ("Chapter Two"). */
  chapterIndex: number;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}) {
  const fileCount = chapter.diffChunks.length;
  const insightCount = chapter.insights.length;
  return (
    <Stack
      component="article"
      id={`chapter-${chapter.id}`}
      aria-labelledby={`chapter-heading-${chapter.id}`}
      gap={28}
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

      {insightCount > 0 && (
        <Stack component="section" gap={16}>
          <SectionRule label="Insights" count={insightCount} />
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={16}>
            {chapter.insights.map((insight, i) => (
              <InsightCallout key={i} insight={insight} />
            ))}
          </SimpleGrid>
        </Stack>
      )}

      {fileCount > 0 && (
        <Stack component="section" gap={20}>
          <SectionRule label="Files in this chapter" count={fileCount} />
          {chapter.diffChunks.map((chunk, i) => (
            <InlineDiffChunk
              key={`${chunk.filename}-${i}`}
              chunk={chunk}
              owner={owner}
              repo={repo}
              baseRef={baseRef}
              headRef={headRef}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
