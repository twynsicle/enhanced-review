import { Box, Text } from '@mantine/core';
import type { OverviewStyle, Prose } from '@/review/narrative';
import { MarkdownText } from './markdown-text';

/**
 * The reviewer's overview: its lede, then its body.
 *
 * The lede is set one step up the scale from the body, in the same face and the
 * same grey. That is the whole of the hierarchy here, and the restraint is
 * deliberate — an earlier version of this component set its first paragraph in
 * the display serif and dimmed everything after it, which put two faces and two
 * greys inside a single run of text and read as an inconsistency rather than a
 * rank. One size step off the shared scale is the sanctioned way to say "read
 * this first", and it is enough.
 *
 * The lede is plain text rather than Markdown. It is one sentence by
 * construction, so there is nothing in it for Markdown to do, and rendering it
 * as a block would put a paragraph wrapper between the two halves of one
 * passage.
 */
export function ProsePassage({
  prose,
  bodyStyle,
}: {
  prose: Prose | undefined;
  /** Which of the passage's bodies is read; one the passage lacks shows the lede alone. */
  bodyStyle: OverviewStyle;
}) {
  const lede = prose?.lede.trim() ?? '';
  const body = prose?.bodies?.[bodyStyle]?.trim() ?? '';

  if (lede.length === 0 && body.length === 0) {
    return <Text c="dimmed">No overview was generated for this review.</Text>;
  }

  return (
    <Box style={{ textWrap: 'pretty' }}>
      {lede.length > 0 && (
        <Text fz="lg" lh={1.5} mb={body.length > 0 ? 12 : 0}>
          {lede}
        </Text>
      )}
      {body.length > 0 && <MarkdownText text={body} />}
    </Box>
  );
}
