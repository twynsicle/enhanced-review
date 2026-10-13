import { Button, Checkbox, Group, Text } from '@mantine/core';
import { SUMMARY_SECTION_ID } from '@/review/narrative';
import { readCountLabel, type ReaderSection } from '@/report/reader/sections';
import { focusHeading } from '@/report/reader/use-narrative-keyboard';
import { token } from '@/report/theme/tokens';

/**
 * The end of a section: where to go next, and for a chapter, whether it has
 * been read.
 *
 * Moving on from a chapter marks it read, since a reader who presses Next has
 * said they are done with it; opening one never does, because a chapter
 * glanced at on the way somewhere else has not been read. The walk is the
 * sidebar's and the keyboard's order, and the last chapter leads back to the
 * summary rather than to nothing.
 */
export function SectionFooter({
  sections,
  section,
  readIds,
  onSetRead,
  onSelect,
}: {
  /** Every section of the reader, in order; see `sections.ts`. */
  sections: readonly ReaderSection[];
  section: ReaderSection;
  readIds: ReadonlySet<string>;
  onSetRead: (chapterId: string, read: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const index = sections.findIndex((s) => s.id === section.id);
  const next = sections[index + 1] ?? null;
  const isChapter = section.kind === 'chapter';
  // A summary with no chapters after it has nowhere to send the reader.
  if (!isChapter && next === null) return null;

  const chapters = sections.filter((s) => s.kind === 'chapter');
  const readCount = chapters.filter((s) => readIds.has(s.id)).length;
  const target = next?.id ?? SUMMARY_SECTION_ID;

  const onNext = (): void => {
    if (isChapter) onSetRead(section.id, true);
    onSelect(target);
    focusHeading(target);
  };

  return (
    <Group
      component="footer"
      justify="space-between"
      align="center"
      gap={16}
      pt={20}
      style={{ borderTop: `1px solid ${token('border')}` }}
    >
      {isChapter && (
        <Group gap={16} align="center">
          <Checkbox
            label="Read"
            size="sm"
            checked={readIds.has(section.id)}
            onChange={(event) => onSetRead(section.id, event.currentTarget.checked)}
          />
          <Text fz="sm" c="dimmed">
            {readCountLabel(readCount, chapters.length)}
          </Text>
        </Group>
      )}
      <Button
        size="sm"
        ml="auto"
        maw="100%"
        onClick={onNext}
        styles={{ label: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }}
      >
        {next === null ? 'Back to summary' : `Next: ${next.label}`}
      </Button>
    </Group>
  );
}
