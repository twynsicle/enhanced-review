import { describe, expect, it } from 'vitest';
import { render, screen } from '@/report/test/render';
import { ProsePassage } from './prose-passage';

describe('<ProsePassage />', () => {
  it('draws the lede above the body', () => {
    render(
      <ProsePassage
        prose={{ lede: 'The lede.', bodies: { narrative: 'The body.' } }}
        bodyStyle="narrative"
      />,
    );
    const lede = screen.getByText('The lede.');
    const body = screen.getByText('The body.');
    // `compareDocumentPosition` reads DOM order: the lede comes first.
    expect(lede.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the body as Markdown, so a list is a list', () => {
    const { container } = render(
      <ProsePassage
        prose={{
          lede: 'Three conditions decide it.',
          bodies: { narrative: '- one\n- two\n- three' },
        }}
        bodyStyle="narrative"
      />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('draws the body in the style being read, and only that one', () => {
    render(
      <ProsePassage
        prose={{ lede: 'The lede.', bodies: { narrative: 'The story.', simple: 'Short words.' } }}
        bodyStyle="simple"
      />,
    );
    expect(screen.getByText('Short words.')).toBeDefined();
    expect(screen.queryByText('The story.')).toBeNull();
  });

  it('draws the lede alone in a style with no body, as tldr always is', () => {
    const { container } = render(
      <ProsePassage
        prose={{ lede: 'That is all there is.', bodies: { narrative: '- hidden' } }}
        bodyStyle="tldr"
      />,
    );
    expect(screen.getByText('That is all there is.')).toBeDefined();
    expect(container.querySelector('li')).toBeNull();
  });

  it('falls back when there is no prose at all', () => {
    render(<ProsePassage prose={undefined} bodyStyle="narrative" />);
    expect(screen.getByText('No overview was generated for this review.')).toBeDefined();
  });
});
