import { Stack, Text, Title } from '@mantine/core';
import { Fragment } from 'react';
import { plural } from '@/common/plural';
import { chaptersCiting, describeCoverageGap, type ReviewCoverage } from '@/domain/review/coverage';
import { UNDISCUSSED_SECTION_ID, type NarrativeChapter } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import { SectionRule } from '@/web/components/narrative/chapter-card';
import classes from '@/web/components/narrative/article.module.css';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { sectionCardId, sectionHeadingId } from '@/web/components/narrative/sections';
import { DISPLAY_SIZE } from '@/web/theme/tokens';

/**
 * The reader's last section: every hunk the chapters did not cite, file by
 * file, through the same inline diff the chapters use. It is the backstop
 * for the instruction that the model cite everything — the rest of the diff,
 * whatever the model chose to narrate. It says what it is and shows the code;
 * it does not pretend to be a chapter, so there is no prose about the hunks
 * and no insights.
 *
 * What it claims is bounded by what the reviewer was given: a hunk from a
 * file the prompt truncated is listed here because no chapter reached it, not
 * because the model read it and passed it over.
 */
export function UndiscussedCard({
  coverage,
  chapters,
  diffTruncated = false,
}: {
  coverage: ReviewCoverage;
  chapters: readonly NarrativeChapter[];
  /** The reviewer's diff was trimmed to fit, so part of this was never listed to it. */
  diffTruncated?: boolean;
}) {
  const { uncited } = coverage;
  return (
    <article
      className={classes.article}
      id={sectionCardId(UNDISCUSSED_SECTION_ID)}
      aria-labelledby={sectionHeadingId(UNDISCUSSED_SECTION_ID)}
    >
      <Stack component="header" gap={12}>
        <Caption tone="before">After the chapters</Caption>
        <Title
          order={1}
          id={sectionHeadingId(UNDISCUSSED_SECTION_ID)}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          Not discussed
        </Title>
        <Text fz="sm" c="dimmed">
          {describeCoverageGap(coverage)}
        </Text>
      </Stack>

      <Text fz="md">
        The chapters cite {coverage.cited} of the {plural(coverage.total, 'hunk')} in this change.
        The rest are here. A file a chapter took some hunks from appears with only the others.
        {diffTruncated
          ? ' This change was too large to put in front of the reviewer whole, so some of what' +
            ' follows was never listed to it rather than passed over.'
          : ''}
      </Text>

      <div data-bleed>
        <SectionRule label="Files" count={uncited.length} />
      </div>

      {/*
       * One row per file: the note keeps the reading measure and only the diff
       * bleeds past it, which is why these are two grid children rather than
       * one wrapper. The note therefore names its file — at this width the row
       * gap alone does not say which diff it belongs to.
       */}
      {uncited.map(({ file, cited, chunk }) => (
        <Fragment key={file.filename}>
          {cited > 0 && (
            <Text fz="sm" c="dimmed">
              Other hunks of {file.filename} are discussed in{' '}
              {chaptersCiting(file.filename, chapters)
                .map((chapter) => chapter.title)
                .join(', ')}
              .
            </Text>
          )}
          <div data-bleed>
            <InlineDiffChunk chunk={chunk} />
          </div>
        </Fragment>
      ))}
    </article>
  );
}
