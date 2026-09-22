import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import classes from './markdown-text.module.css';

/**
 * Thin wrapper around `react-markdown` with GFM (tables, task lists,
 * strikethrough) and `highlight.js`-driven code-fence highlighting.
 *
 * Default sanitisation (no `rehype-raw`): the reviewer's chapters land at
 * trust level "anything the model said", and a PR body is whatever its
 * author typed. The wrapper isolates the rest of the app from the rendering
 * library so a future swap is one file.
 */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className={classes.root}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </Markdown>
    </div>
  );
}
