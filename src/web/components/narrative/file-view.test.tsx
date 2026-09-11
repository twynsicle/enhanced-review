import { describe, expect, it } from 'vitest';
import type { NarrativeChapter } from '@/domain/review/narrative';
import { render, screen } from '@/web/test/render';
import { FileView } from './file-view';

const chapters: NarrativeChapter[] = [
  { id: 'ch1', title: 'Shape of the change', insights: [], diffChunks: [] },
];

describe('FileView without hunks', () => {
  it('says why a skipped file was not reviewed', () => {
    render(
      <FileView
        filename="src/generated/client.ts"
        chapters={chapters}
        files={[
          {
            filename: 'src/generated/client.ts',
            status: 'modified',
            additions: 300,
            deletions: 12,
            skipped: 'generated',
          },
        ]}
      />,
    );
    expect(screen.getByText(/marked linguist-generated in .gitattributes/)).toBeDefined();
  });

  it('says the reviewer chose no hunks for a reviewed file', () => {
    render(
      <FileView
        filename="src/app.ts"
        chapters={chapters}
        files={[{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1 }]}
      />,
    );
    expect(screen.getByText(/didn’t select any hunks for this file/)).toBeDefined();
  });
});
