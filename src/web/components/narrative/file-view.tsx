import { Group, Stack, Text, Title } from '@mantine/core';
import type { DiffChunk, NarrativeChapter, ReviewFile } from '@/domain/review/narrative';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { token } from '@/web/theme/tokens';

/**
 * File-only view: every chunk any chapter selected from one file, so the
 * reader sees the full diff context the reviewer chose independent of the
 * narrative order. A file listed in `files[]` with no chunk anywhere gets the
 * "no hunks" note instead.
 */
export function FileView({
  filename,
  chapters,
  files,
  owner,
  repo,
  baseRef,
  headRef,
}: {
  filename: string;
  chapters: readonly NarrativeChapter[];
  files?: readonly ReviewFile[];
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}) {
  const chunks: { chunk: DiffChunk; chapter: NarrativeChapter }[] = [];
  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      if (chunk.filename === filename) chunks.push({ chunk, chapter });
    }
  }

  const fileMeta = files?.find((f) => f.filename === filename) ?? null;
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
        <Text
          fz={11}
          fw={500}
          tt="uppercase"
          c={token('before')}
          style={{ letterSpacing: '0.18em' }}
        >
          File
        </Text>
        <Title
          order={1}
          tabIndex={-1}
          ff="monospace"
          fz={28}
          fw={600}
          lh={1.15}
          style={{ letterSpacing: '-0.01em', outline: 'none', wordBreak: 'break-all' }}
        >
          {dirname.length > 0 && (
            <Text component="span" fz={18} fw={500} c={token('subtle')}>
              {dirname}/
            </Text>
          )}
          <span>{basename}</span>
        </Title>
        <Group gap={12} fz={13} c="dimmed" style={{ rowGap: 4 }}>
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
          {chunks.length > 0 && (
            <>
              {dot}
              <span>
                Discussed in{' '}
                {chunks.map((c, i) => (
                  <span key={c.chapter.id}>
                    {i > 0 && ', '}
                    <Text component="span" fz="inherit" c={token('foreground')}>
                      {c.chapter.title}
                    </Text>
                  </span>
                ))}
              </span>
            </>
          )}
        </Group>
      </Stack>

      {chunks.length > 0 ? (
        <Stack component="section" gap={20}>
          {chunks.map(({ chunk }, i) => (
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
      ) : (
        <Text
          px={16}
          py={20}
          fz={13.5}
          c="dimmed"
          style={{
            borderRadius: 8,
            border: `1px solid ${token('border')}`,
            background: `color-mix(in oklab, ${token('card')} 60%, transparent)`,
          }}
        >
          The reviewer didn’t select any hunks for this file, so there’s no inline diff. The file
          may still be listed because it changed — open it on GitHub to see the full diff.
        </Text>
      )}
    </Stack>
  );
}
