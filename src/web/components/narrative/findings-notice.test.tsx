import { describe, expect, it } from 'vitest';
import { finding } from '@/domain/review/findings';
import { render, screen } from '@/web/test/render';
import { FindingsNotice } from './findings-notice';

describe('<FindingsNotice />', () => {
  it('lists every warning, in the order they were found', () => {
    render(
      <FindingsNotice
        findings={[
          finding('diagram-dropped', 'A diagram could not be read and was dropped.'),
          finding('diff-truncated', 'The diff was too large to show the reviewer whole.'),
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'A diagram could not be read and was dropped.',
      'The diff was too large to show the reviewer whole.',
    ]);
  });

  it('draws nothing at all when there is nothing to warn about', () => {
    render(<FindingsNotice findings={[]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ignores notes, which cost the reader nothing', () => {
    render(
      <FindingsNotice
        findings={[finding('chunks-merged', 'Two chunks naming one file were merged.')]}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
