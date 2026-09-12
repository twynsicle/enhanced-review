import { Stack, Text, Title } from '@mantine/core';
import type { ReviewCoverage } from '@/domain/review/coverage';
import type { NarrativeChapter } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import { SectionRule } from '@/web/components/narrative/chapter-card';
import classes from '@/web/components/narrative/article.module.css';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { DISPLAY_SIZE } from '@/web/theme/tokens';

/**
 * The reader's last section: every hunk the chapters did not cite, file by
 * file, through the same inline diff the chapters use. It is the backstop
 * for the instruction that the model cite everything — a reader who reaches
 * the end of this has seen the whole change, whatever the model chose to
 * narrate. It says what it is and shows the code; it does not pretend to be
 * a chapter, so there is no prose about the hunks and no insights.
 */
export function UndiscussedCard({
  coverage,
  chapters,
}: {
  coverage: ReviewCoverage;
  chapters: readonly NarrativeChapter[];
}) {
  const { uncitedChunks, partly } = coverage;
  return (
    <article
      className={classes.article}
      id="section-undiscussed"
      aria-labelledby="undiscussed-heading"
    >
      <Stack component="header" gap={12}>
        <Caption tone="before">After the chapters</Caption>
        <Title
          order={1}
          id="undiscussed-heading"
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          Not discussed
        </Title>
        <Text fz="sm" c="dimmed">
          {describeGap(coverage)}
        </Text>
      </Stack>

      <Text fz="md">
        The chapters cite {coverage.cited} of {coverage.total} hunks. The rest are here, so that
        finishing the review means having seen the whole change. A file listed in a chapter for some
        of its hunks appears here with only the others.
      </Text>

      <Stack component="section" gap={20} data-bleed>
        <SectionRule label="Files" count={uncitedChunks.length} />
        {uncitedChunks.map((chunk) => {
          const elsewhere = partly.some((c) => c.file.filename === chunk.filename)
            ? chaptersCiting(chunk.filename, chapters)
            : [];
          return (
            <Stack key={chunk.filename} gap={8}>
              {elsewhere.length > 0 && (
                <Text fz="sm" c="dimmed">
                  Other hunks of this file are discussed in {elsewhere.join(', ')}.
                </Text>
              )}
              <InlineDiffChunk chunk={chunk} />
            </Stack>
          );
        })}
      </Stack>
    </article>
  );
}

const files = (count: number) => `${String(count)} file${count === 1 ? '' : 's'}`;

function describeGap({ undiscussed, partly }: ReviewCoverage): string {
  if (partly.length === 0) return `${files(undiscussed.length)} not discussed in any chapter`;
  if (undiscussed.length === 0) return `${files(partly.length)} discussed only in part`;
  return `${files(undiscussed.length)} not discussed in any chapter, ${files(partly.length)} only in part`;
}

function chaptersCiting(filename: string, chapters: readonly NarrativeChapter[]): string[] {
  return chapters
    .filter((chapter) => chapter.diffChunks.some((chunk) => chunk.filename === filename))
    .map((chapter) => chapter.title);
}
