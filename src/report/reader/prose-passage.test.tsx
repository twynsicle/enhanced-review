import { describe, expect, it } from 'vitest';
import { render, screen } from '@/report/test/render';
import { ProsePassage } from './prose-passage';

describe('<ProsePassage />', () => {
  it('draws the lede above the body', () => {
    render(<ProsePassage prose={{ lede: 'The lede.', body: 'The body.' }} />);
    const lede = screen.getByText('The lede.');
    const body = screen.getByText('The body.');
    // `compareDocumentPosition` reads DOM order: the lede comes first.
    expect(lede.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the body as Markdown, so a list is a list', () => {
    const { container } = render(
      <ProsePassage
        prose={{ lede: 'Three conditions decide it.', body: '- one\n- two\n- three' }}
      />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('draws a lede with no body', () => {
    const { container } = render(<ProsePassage prose={{ lede: 'That is all there is.' }} />);
    expect(screen.getByText('That is all there is.')).toBeDefined();
    expect(container.querySelector('li')).toBeNull();
  });

  it('falls back when there is no prose at all', () => {
    render(<ProsePassage prose={undefined} emptyFallback="Nothing was written." />);
    expect(screen.getByText('Nothing was written.')).toBeDefined();
  });
});
