import { Box, Text } from '@mantine/core';
import { MarkdownText } from './markdown-text';

/**
 * A narrative passage: the reviewer's overview, or a chapter's description.
 *
 * It renders as plain body prose. There is deliberately no lead/rest split
 * any more — the passage used to set its first paragraph in the display serif
 * and dim everything after it, which put two faces and two greys inside a
 * single run of text and read as an inconsistency rather than a hierarchy.
 * Rank on this page comes from the heading above the passage, not from
 * restyling the passage itself.
 */
export function LeadMarkdown({
  text,
  emptyFallback = 'No overview was generated for this review.',
}: {
  text: string;
  emptyFallback?: string;
}) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return <Text c="dimmed">{emptyFallback}</Text>;
  }

  return (
    <Box maw="76ch" style={{ textWrap: 'pretty' }}>
      <MarkdownText text={trimmed} />
    </Box>
  );
}
