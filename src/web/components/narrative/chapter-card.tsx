import { Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { NarrativeChapter } from '@/domain/review/narrative';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { InsightCallout } from '@/web/components/narrative/insight-callout';
import { LeadMarkdown } from '@/web/components/narrative/lead-markdown';
import { token } from '@/web/theme/tokens';

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
      <Text
        component="span"
        fz={10.5}
        fw={600}
        tt="uppercase"
        c={token('subtle')}
        style={{ letterSpacing: '0.18em' }}
      >
        {label}
      </Text>
      <Text component="span" ff="monospace" fz={11} c={token('subtle')}>
        {count}
      </Text>
    </Group>
  );
}

/** One chapter as an article: eyebrow, serif title, lead, insights grid, files. */
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
        <Text
          fz={11}
          fw={500}
          tt="uppercase"
          c={token('before')}
          style={{ letterSpacing: '0.18em' }}
        >
          {chapterEyebrow(chapterIndex)}
        </Text>
        <Title
          order={1}
          id={`chapter-heading-${chapter.id}`}
          tabIndex={-1}
          fz={42}
          fw={600}
          lh={1.05}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {chapter.title}
        </Title>
        <Text fz={13} c="dimmed">
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
