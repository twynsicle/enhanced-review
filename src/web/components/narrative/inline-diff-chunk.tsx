import { Group, Stack, Text } from '@mantine/core';
import { formatSelectedHunkLabel, groupSelectedHunks } from '@/domain/review/inline-diff-snippets';
import type { DiffChunk } from '@/domain/review/narrative';
import { token } from '@/web/theme/tokens';

/**
 * One file's reviewer-selected hunks inside a chapter. Until phase-4 commit
 * 5 ports the Monaco inline diff, this lists the selected line ranges so the
 * reader shows what the reviewer pointed at; the file-blob fetch, the editor
 * and the `--er-hljs-*` tokens arrive with that commit.
 */
export function InlineDiffChunk({ chunk }: { chunk: DiffChunk }) {
  const groups = groupSelectedHunks(chunk.hunks);
  return (
    <Stack
      component="section"
      gap={8}
      p={16}
      style={{ borderRadius: 8, border: `1px solid ${token('border')}`, background: token('card') }}
    >
      <Group justify="space-between" gap={12} wrap="nowrap">
        <Text ff="monospace" fz={12.5} fw={600} truncate>
          {chunk.filename}
        </Text>
        <Text ff="monospace" fz={11} c={token('subtle')} style={{ flexShrink: 0 }}>
          {chunk.language}
        </Text>
      </Group>
      {groups.length > 0 ? (
        <Text ff="monospace" fz={11.5} c="dimmed">
          {groups.map((group) => formatSelectedHunkLabel(group)).join(' · ')}
        </Text>
      ) : (
        <Text fz={12.5} c="dimmed">
          No hunks were selected for this file.
        </Text>
      )}
    </Stack>
  );
}
