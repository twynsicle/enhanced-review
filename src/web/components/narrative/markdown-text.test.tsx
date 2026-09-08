import { describe, expect, it } from 'vitest';
import { render } from '@/web/test/render';
import { MarkdownText } from './markdown-text';

describe('<MarkdownText />', () => {
  it('renders headings, bold, inline code', () => {
    const { container } = render(
      <MarkdownText text={'## Heading\nSome **bold** and `code` text.'} />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Heading');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('renders fenced code blocks with a highlighted <code>', () => {
    const text = '```ts\nconst x = 1;\n```';
    const { container } = render(<MarkdownText text={text} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const code = pre?.querySelector('code');
    expect(code?.textContent).toContain('const');
    expect(code?.className).toContain('hljs');
  });

  it('supports GFM tables (remark-gfm)', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<MarkdownText text={md} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td').length).toBe(2);
  });

  it('strips raw HTML by default (no rehype-raw)', () => {
    const { container } = render(
      <MarkdownText text={'<script>alert(1)</script>plain text after'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('plain text after');
  });
});
