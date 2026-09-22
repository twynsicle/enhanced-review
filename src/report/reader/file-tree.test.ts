import { describe, expect, it } from 'vitest';
import type { ReviewFile } from '@/review/narrative';
import { buildFileTree, fileTreeFiles, type FileTreeNode } from './file-tree';

function file(filename: string): ReviewFile {
  return { filename, status: 'modified', additions: 1, deletions: 0 };
}

function tree(...filenames: string[]): readonly FileTreeNode[] {
  return buildFileTree(filenames.map(file));
}

/** `dir/ [children]` for a directory, `name` for a file — the shape, in one line. */
function outline(nodes: readonly FileTreeNode[]): string {
  return nodes
    .map((node) => (node.kind === 'file' ? node.name : `${node.name}/ [${outline(node.children)}]`))
    .join(' ');
}

describe('buildFileTree', () => {
  it('puts a file with no directory at the root', () => {
    expect(outline(tree('README.md', 'package.json'))).toBe('README.md package.json');
  });

  it('groups siblings under the directory they share', () => {
    expect(outline(tree('src/a.ts', 'src/b.ts'))).toBe('src/ [a.ts b.ts]');
  });

  it('keeps root files beside nested ones', () => {
    expect(outline(tree('docs/guide.md', 'package.json', 'src/a.ts'))).toBe(
      'docs/ [guide.md] package.json src/ [a.ts]',
    );
  });

  it('collapses a chain of single-child directories into one row', () => {
    expect(outline(tree('src/web/components/a.tsx', 'src/web/components/b.tsx'))).toBe(
      'src/web/components/ [a.tsx b.tsx]',
    );
  });

  it('stops collapsing where the directory offers a choice', () => {
    expect(outline(tree('src/web/a.ts', 'src/jobs/b.ts'))).toBe('src/ [web/ [a.ts] jobs/ [b.ts]]');
  });

  it('does not collapse a directory into the single file it holds', () => {
    // Folding `legacy` away would leave a file row where a directory was, and
    // nothing on it to say the difference.
    expect(outline(tree('src/legacy/cron.ts', 'src/queue.ts'))).toBe(
      'src/ [legacy/ [cron.ts] queue.ts]',
    );
  });

  it('collapses down to the last directory that still holds one file', () => {
    expect(outline(tree('a/b/c/only.ts'))).toBe('a/b/c/ [only.ts]');
  });

  it('separates two files differing only at the last segment', () => {
    expect(outline(tree('src/web/page.tsx', 'src/web/page.test.tsx'))).toBe(
      'src/web/ [page.tsx page.test.tsx]',
    );
  });

  it('reads a leading or repeated separator as the tidy spelling of the path', () => {
    expect(outline(tree('/src/a.ts', 'src//b.ts'))).toBe('src/ [a.ts b.ts]');
  });

  it('falls back to the whole filename when a path has no segments', () => {
    expect(outline(tree('/'))).toBe('/');
  });

  it('keeps a directory and a file that share a name apart', () => {
    expect(outline(tree('config', 'config/app.ts'))).toBe('config config/ [app.ts]');
  });

  it('keeps the order the files arrived in, so the two views read the same way', () => {
    const names = ['docs/a.md', 'docs/b.md', 'package.json', 'src/web/x.ts'];
    expect(fileTreeFiles(tree(...names)).map((f) => f.filename)).toEqual(names);
  });

  it('lists every file exactly once, whatever the nesting', () => {
    const names = [
      '/leading.txt',
      'a/b/c/deep.ts',
      'a/b/other.ts',
      'config',
      'config/app.ts',
      'root.md',
      'src//doubled.ts',
    ];
    const listed = fileTreeFiles(tree(...names)).map((f) => f.filename);
    expect(listed.toSorted()).toEqual(names.toSorted());
  });
});
