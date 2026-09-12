import { Group, Stack, Text, Title } from '@mantine/core';
import { chaptersCiting, type FileCoverage } from '@/domain/review/coverage';
import type { DiffChunk, NarrativeChapter, ReviewFile } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { SKIP_REASON_TEXT } from '@/web/components/narrative/skipped-file';
import { token } from '@/web/theme/tokens';

/**
 * File-only view: every chunk any chapter selected from one file, so the
 * reader sees the full diff context the reviewer chose independent of the
 * narrative order — and, after those, whatever hunks of the file no chapter
 * cited, under their own label, so the file view is the whole file's change.
 * A file listed in `files[]` with nothing to show gets a note instead: why it
 * was skipped, or why there is no diff.
 *
 * `coverage` is the reader's, computed once over the whole review rather than
 * recomputed per file here: the two could disagree, and the sidebar's mark
 * and this header would then be counting different things. It is required,
 * and `null` says this file carries no catalog: a call site that could leave
 * it out would silently turn a fully catalogued file into one the note claims
 * the reviewer was never given.
 */
export function FileView({
  filename,
  chapters,
  files,
  coverage,
}: {
  filename: string;
  chapters: readonly NarrativeChapter[];
  files?: readonly ReviewFile[];
  coverage: FileCoverage | null;
}) {
  const chunks: DiffChunk[] = [];
  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      if (chunk.filename === filename) chunks.push(chunk);
    }
  }
  const discussedIn = chaptersCiting(filename, chapters);

  const fileMeta = files?.find((f) => f.filename === filename) ?? null;
  const leftover = coverage?.chunk ?? null;
  const slash = filename.lastIndexOf('/');
  const basename = slash === -1 ? filename : filename.slice(slash + 1);
  const dirname = slash === -1 ? '' : filename.slice(0, slash);
  const hasStats = fileMeta !== null && (fileMeta.additions > 0 || fileMeta.deletions > 0);
  const dot = (
    <Text component="span" fz="inherit" aria-hidden>
      ·
    </Text>
  );

  return (
    <Stack component="article" id={`file-${filename}`} gap={28}>
      <Stack component="header" gap={12}>
        <Caption tone="before">File</Caption>
        <Title
          order={1}
          tabIndex={-1}
          ff="monospace"
          fz="xl"
          fw={600}
          lh={1.15}
          style={{ letterSpacing: '-0.01em', outline: 'none', wordBreak: 'break-all' }}
        >
          {dirname.length > 0 && (
            <Text component="span" fz="lg" fw={500} c="dimmed">
              {dirname}/
            </Text>
          )}
          <span>{basename}</span>
        </Title>
        <Group gap={12} fz="sm" c="dimmed" style={{ rowGap: 4 }}>
          {fileMeta && (
            <Text component="span" fz="inherit" tt="capitalize">
              {fileMeta.status}
            </Text>
          )}
          {hasStats && (
            <>
              {dot}
              <span>
                <Text component="span" fz="inherit" c={token('add')}>
                  +{fileMeta.additions}
                </Text>{' '}
                <Text component="span" fz="inherit" c={token('del')}>
                  -{fileMeta.deletions}
                </Text>
              </span>
            </>
          )}
          {discussedIn.length > 0 && (
            <>
              {dot}
              <span>
                Discussed in{' '}
                {discussedIn.map((chapter, i) => (
                  <span key={chapter.id}>
                    {i > 0 && ', '}
                    <Text component="span" fz="inherit" c={token('foreground')}>
                      {chapter.title}
                    </Text>
                  </span>
                ))}
                {leftover && coverage && (
                  <>
                    {' '}
                    ({coverage.cited} of {coverage.total} hunks)
                  </>
                )}
              </span>
            </>
          )}
          {chunks.length === 0 && leftover && (
            <>
              {dot}
              <span>Not discussed in any chapter</span>
            </>
          )}
        </Group>
      </Stack>

      {chunks.length > 0 && (
        <Stack component="section" gap={20}>
          {chunks.map((chunk, i) => (
            <InlineDiffChunk key={`${chunk.filename}-${i}`} chunk={chunk} />
          ))}
        </Stack>
      )}

      {leftover && (
        <Stack component="section" gap={12} aria-label="Hunks not discussed in any chapter">
          {chunks.length > 0 && <Caption>Not discussed in any chapter</Caption>}
          <InlineDiffChunk chunk={leftover} />
        </Stack>
      )}

      {chunks.length === 0 && !leftover && (
        <Text
          px={16}
          py={20}
          fz="md"
          c="dimmed"
          style={{
            borderRadius: 8,
            border: `1px solid ${token('border')}`,
            background: `color-mix(in oklab, ${token('card')} 60%, transparent)`,
          }}
        >
          {emptyNote(fileMeta)}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Why there is no diff to show. The counts decide between the two ways a
 * catalogued file can arrive with an empty catalog: no text changed at all —
 * a mode flip, a rename — or the diff the reviewer was given did not carry
 * this file's patch. Claiming "no text diff" over a file with a line count
 * beside it on the same page is the one thing this must not do. A file with
 * no catalog comes from an older review, where whether the reviewer chose
 * hunks is all that can be said.
 */
function emptyNote(fileMeta: ReviewFile | null): string {
  if (fileMeta?.skipped) return SKIP_REASON_TEXT[fileMeta.skipped];
  if (!fileMeta?.hunks)
    return 'The reviewer didn’t select any hunks for this file, so there’s no inline diff. It is listed because it changed.';
  if (fileMeta.additions + fileMeta.deletions > 0)
    return 'This file’s patch wasn’t among the hunks the reviewer was given, so there’s no inline diff. It is listed because it changed.';
  return 'This file changed without a text diff to show. It is listed because it changed.';
}
