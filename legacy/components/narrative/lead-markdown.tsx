import { MarkdownText } from './markdown-text';

interface LeadMarkdownProps {
  text: string;
  /** Base font size in px for the lead paragraph. Defaults to 18 (summary). */
  size?: number;
  /** Empty-state fallback. Defaults to the summary copy. */
  emptyFallback?: string;
}

/**
 * Editorial passage layout: the first paragraph reads as the lead,
 * subsequent paragraphs render slightly smaller and muted as supporting
 * body. No drop cap — typography carries the hierarchy through size and
 * weight alone, which keeps the page calmer when several passages stack.
 */
export function LeadMarkdown({
  text,
  size = 18,
  emptyFallback = 'No overview was generated for this review.',
}: LeadMarkdownProps) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return <p className="text-muted-foreground">{emptyFallback}</p>;
  }

  const firstBreak = trimmed.indexOf('\n\n');
  const sizeStyle = { fontSize: `${String(size)}px` };

  if (firstBreak === -1) {
    return (
      <div className="font-serif leading-[1.65] text-pretty" style={sizeStyle}>
        <MarkdownText text={trimmed} />
      </div>
    );
  }
  const first = trimmed.slice(0, firstBreak).trim();
  const rest = trimmed.slice(firstBreak).trim();

  return (
    <div className="font-serif leading-[1.65] text-pretty" style={sizeStyle}>
      <MarkdownText text={first} />
      {rest.length > 0 && (
        <div
          className="mt-5 text-muted-foreground"
          style={{ fontSize: `${String(Math.max(14, size - 2))}px` }}
        >
          <MarkdownText text={rest} />
        </div>
      )}
    </div>
  );
}
