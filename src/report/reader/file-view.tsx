import { Group, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import { chaptersCiting, citedChunk, type FileCoverage } from '@/review/coverage';
import type { NarrativeChapter, ReviewFile } from '@/review/narrative';
import { Caption } from '@/report/chrome/caption';
import { originVerb, similarityText } from '@/report/reader/file-origin';
import { InlineDiffChunk } from '@/report/reader/inline-diff-chunk';
import { SKIP_REASON_TEXT } from '@/report/reader/skipped-file';
import { token } from '@/report/theme/tokens';

/**
 * File-only view: every hunk any chapter selected from one file, merged into
 * a single diff in file order, so the reader sees the diff context the
 * reviewer chose independent of the narrative order — and, after it, whatever
 * hunks of the file no chapter cited, under their own label, so the file view
 * is the whole file's change. The leftovers stay a diff of their own rather
 * than joining the merge: what the reviewer passed over is the one thing this
 * view must not blur into what it discussed.
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
  /*
   * Memoised for its identity, not its cost: the merge is cheap, but it
   * builds a fresh `hunks` array, and `InlineDiffChunk` keys its snippet
   * memo on that array. Recomputed per render, every re-render of this view
   * re-slices both full file texts around every hunk group. The leftover
   * chunk beside it comes off the reader's memoised coverage and so is
   * already stable; this is the half that was not.
   */
  const cited = useMemo(() => citedChunk(filename, chapters), [filename, chapters]);
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
          {fileMeta?.origin ? (
            <>
              <span>
                {originVerb(fileMeta)}{' '}
                <Text
                  component="span"
                  ff="monospace"
                  fz="inherit"
                  c={token('foreground')}
                  style={{ wordBreak: 'break-all' }}
                >
                  {fileMeta.origin.filename}
                </Text>
              </span>
              {dot}
              <span>{similarityText(fileMeta.origin.similarity)}</span>
            </>
          ) : (
            fileMeta && (
              <Text component="span" fz="inherit" tt="capitalize">
                {fileMeta.status}
              </Text>
            )
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
          {cited === null && leftover && (
            <>
              {dot}
              <span>Not discussed in any chapter</span>
            </>
          )}
        </Group>
      </Stack>

      {cited !== null && (
        <Stack component="section">
          <InlineDiffChunk chunk={cited} />
        </Stack>
      )}

      {leftover && (
        <Stack component="section" gap={12} aria-label="Hunks not discussed in any chapter">
          {cited !== null && <Caption>Not discussed in any chapter</Caption>}
          <InlineDiffChunk chunk={leftover} />
        </Stack>
      )}

      {cited === null && !leftover && (
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
 * no catalog at all — the executor returned none — supports no such claim,
 * so all that can be said is whether the reviewer chose any hunks.
 */
function emptyNote(fileMeta: ReviewFile | null): string {
  if (fileMeta?.skipped) return SKIP_REASON_TEXT[fileMeta.skipped];
  if (!fileMeta?.hunks)
    return 'The reviewer didn’t select any hunks for this file, so there’s no inline diff. It is listed because it changed.';
  if (fileMeta.additions + fileMeta.deletions > 0)
    return 'This file’s patch wasn’t among the hunks the reviewer was given, so there’s no inline diff. It is listed because it changed.';
  if (fileMeta.origin?.similarity === 100)
    return 'Only the path changed. The content is the same at both paths, so there’s no diff to show.';
  return 'This file changed without a text diff to show. It is listed because it changed.';
}
