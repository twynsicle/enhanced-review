import { Box, Text } from '@mantine/core';
import { MarkdownText } from './markdown-text';

/**
 * Editorial passage layout: serif body, the first paragraph as the lead and
 * later paragraphs muted as supporting body. No drop cap: family and weight
 * carry the hierarchy, which keeps the page calmer when passages stack. Both
 * halves render at the markdown body size, as on `main` (its `size` prop
 * never reached the text, so the rendered 14px is what the reader matches).
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

  const firstBreak = trimmed.indexOf('\n\n');
  const first = firstBreak === -1 ? trimmed : trimmed.slice(0, firstBreak).trim();
  const rest = firstBreak === -1 ? '' : trimmed.slice(firstBreak).trim();

  return (
    <Box ff="heading" lh={1.65} style={{ textWrap: 'pretty' }}>
      <MarkdownText text={first} />
      {rest.length > 0 && (
        <Box mt={20} c="dimmed">
          <MarkdownText text={rest} />
        </Box>
      )}
    </Box>
  );
}
