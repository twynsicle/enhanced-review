import { describe, expect, it } from 'vitest';
import type { RunContext } from '../cli/context.ts';
import { changeSize } from './diagram-contrive.ts';

const context = {
  files: [
    { filename: 'src/a.ts' },
    { filename: 'src/b.ts' },
    { filename: 'package-lock.json', skipped: 'generated' },
  ],
  hunks: [{ id: 'H0001' }, { id: 'H0002' }, { id: 'H0003' }],
} as unknown as RunContext;

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' kept',
  '-gone',
  '+here',
  '+and here',
  '--- a removed SQL comment',
  '+++counter',
  '',
].join('\n');

describe('changeSize', () => {
  it('counts the reviewed files, the hunks, and the diff’s own added and removed lines', () => {
    expect(changeSize(context, diff)).toEqual({ files: 2, hunks: 3, added: 3, removed: 2 });
  });
});
