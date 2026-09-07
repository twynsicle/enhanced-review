import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/**
 * Thin wrapper around `react-markdown` with GFM (tables, task lists,
 * strikethrough) and `highlight.js`-driven code-fence highlighting.
 *
 * Default sanitization (no `rehype-raw`) — the Claude executor shouldn't be
 * emitting raw HTML, and the AI's review chapters land at trust-level "anything
 * the model said". The wrapper isolates the rest of the codebase from
 * the rendering library so a future swap is one file.
 *
 * Element styles live on the wrapper via Tailwind's `[&_…]` selectors so
 * we don't need the typography plugin for this small set of tags.
 */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div
      className={[
        'text-sm leading-relaxed text-foreground break-words',
        '[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_h1]:mt-5 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold',
        '[&_h2]:mt-5 [&_h2]:mb-3 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted-foreground',
        '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-1',
        '[&_a]:text-primary [&_a]:underline [&_a:hover]:no-underline',
        '[&_strong]:font-semibold',
        '[&_em]:italic',
        '[&_hr]:my-4 [&_hr]:border-foreground/10',
        '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-mono',
        '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[#0d1117] [&_pre]:p-3 [&_pre]:text-xs',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit',
        '[&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_table]:border-collapse',
        '[&_th]:border-b [&_th]:border-foreground/15 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold',
        '[&_td]:border-b [&_td]:border-foreground/10 [&_td]:px-2 [&_td]:py-1',
      ].join(' ')}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
