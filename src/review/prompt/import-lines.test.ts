import { describe, expect, it } from 'vitest';
import { importLines, isScriptFile } from './import-lines.ts';

const lines = (...source: string[]) =>
  [...importLines(source.join('\n'))].toSorted((a, b) => a - b);

describe('importLines', () => {
  it('finds each kind of import and re-export, with or without a semicolon', () => {
    expect(
      lines(
        "import a from './a';",
        "import { b, c as d } from './b'",
        "import * as e from './e';",
        "import f, { g } from './f';",
        "import type { H } from './h';",
        "import './polyfill';",
        "export * from './i';",
        "export * as j from './j';",
        "export { k, type L } from './k';",
        "export type { M } from './m';",
        "import data from './data.json' with { type: 'json' };",
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('takes a statement over every line it is written on', () => {
    expect(
      lines(
        "import { a } from './a';",
        'import {',
        '  b,',
        '  type C,',
        "} from './b';",
        '',
        'const x = 1;',
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts no code: a dynamic import, an export of its own, a declaration', () => {
    expect(
      lines(
        "const m = await import('./m');",
        'export { a, b };',
        'export const c = 1;',
        'import.meta.url;',
        "import a from './a'; run();",
      ),
    ).toEqual([]);
  });

  it('never reads an import inside a string, template, comment or block', () => {
    expect(
      lines(
        'const fixture = `',
        "import a from './a';",
        '`;',
        '/*',
        "import b from './b';",
        '*/',
        'function f() {',
        "  import c from './c';",
        '}',
        "import d from './d';",
      ),
    ).toEqual([10]);
  });

  it('finds the top level again after a template holding an expression', () => {
    expect(lines('const s = `${{ a: 1 }.a}`;', "import a from './a';")).toEqual([2]);
  });
});

describe('isScriptFile', () => {
  it('knows TypeScript and JavaScript and nothing else', () => {
    expect(
      ['a.ts', 'a.tsx', 'a.mts', 'a.cjs', 'a.jsx', 'a.py', 'a.json', 'a.d.ts'].map(isScriptFile),
    ).toEqual([true, true, true, true, true, false, false, true]);
  });
});
