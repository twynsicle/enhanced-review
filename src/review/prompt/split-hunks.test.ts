import { describe, expect, it } from 'vitest';
import { buildDiffHunkIndex, toResolvedHunk } from './diff-hunk-catalog.ts';
import { splitPatch } from './split-hunks.ts';

const FILE = 'src/x.ts';

const PREAMBLE = [
  'diff --git a/src/x.ts b/src/x.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/x.ts',
];

/** A new file's patch: one `+` line per source line. */
function newFile(source: string[]): string {
  return [
    ...PREAMBLE,
    `@@ -0,0 +1,${String(source.length)} @@`,
    ...source.map((l) => `+${l}`),
    '',
  ].join('\n');
}

function fn(name: string, bodyLines: number, indent = ''): string[] {
  return [
    `${indent}function ${name}() {`,
    ...Array.from({ length: bodyLines }, (_, i) => `${indent}  step${String(i)}();`),
    `${indent}}`,
    '',
  ];
}

/** Eight lines of a function's body, numbered from `from`. */
function steps(from: number): string[] {
  return Array.from({ length: 8 }, (_, i) => `  const v${String(from + i)} = step();`);
}

function hunksOf(patch: string) {
  return buildDiffHunkIndex(patch).hunks;
}

describe('splitPatch', () => {
  it('leaves a hunk at or under the target as git wrote it', () => {
    const patch = newFile(fn('a', 5));
    expect(splitPatch(patch, 20, FILE)).toBe(patch);
  });

  it('keeps every hunk whole when the target is 0', () => {
    const patch = newFile([...fn('a', 30), ...fn('b', 30)]);
    expect(splitPatch(patch, 0, FILE)).toBe(patch);
  });

  it('splits a new file between its top-level declarations', () => {
    const source = ['import { x } from "x";', '', ...fn('a', 15), ...fn('b', 15), ...fn('c', 15)];
    const split = splitPatch(newFile(source), 20, FILE);
    const hunks = hunksOf(split);

    expect(hunks.map((h) => h.header)).toEqual([
      '@@ -0,0 +1,20 @@ (part 1 of 3)',
      '@@ -0,0 +21,18 @@ (part 2 of 3)',
      '@@ -0,0 +39,18 @@ (part 3 of 3)',
    ]);
    // The import packs with the first function; each part starts on a declaration.
    const text = split.split('\n');
    expect(text[text.indexOf('@@ -0,0 +21,18 @@ (part 2 of 3)') + 1]).toBe('+function b() {');
    // Every line of the file is in exactly one part.
    expect(hunks.reduce((sum, h) => sum + h.modified.lineCount, 0)).toBe(source.length);
  });

  it('packs small declarations together up to the target instead of one part each', () => {
    const source = Array.from({ length: 12 }, (_, i) => fn(`f${String(i)}`, 2)).flat();
    const hunks = hunksOf(splitPatch(newFile(source), 20, FILE));
    // Twelve five-line functions at about twenty lines a part.
    expect(hunks).toHaveLength(3);
    for (const hunk of hunks) expect(hunk.modified.lineCount).toBeLessThanOrEqual(20);
  });

  it('splits a class body between its members when the class is one top-level block', () => {
    const source = [
      'export class Store {',
      ...fn('load', 12, '  '),
      ...fn('save', 12, '  '),
      ...fn('clear', 12, '  ').slice(0, -1),
      '}',
      '',
    ];
    const split = splitPatch(newFile(source), 20, FILE);
    const firstLines = split
      .split('\n')
      .flatMap((line, i, all) => (line.startsWith('@@') ? [all[i + 1]] : []));
    expect(firstLines).toEqual([
      '+export class Store {',
      '+  function save() {',
      '+  function clear() {',
    ]);
  });

  it('keeps a doc comment with the declaration it documents', () => {
    const doc = ['/**', ' * Loads it.', ' */'];
    const source = [...fn('a', 20), ...doc, ...fn('b', 20)];
    const split = splitPatch(newFile(source), 20, FILE);
    expect(split).toContain('(part 2 of 2)\n+/**\n+ * Loads it.');
  });

  it('never parts an edit’s deleted lines from the lines that replace them', () => {
    const removed = [
      '-',
      ...fn('old', 25)
        .slice(0, -1)
        .map((l) => `-${l}`),
    ];
    const added = [
      '+',
      ...fn('replacement', 25)
        .slice(0, -1)
        .map((l) => `+${l}`),
    ];
    const body = [' keep();', ...removed, ...added, ' tail();'];
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -10,29 +10,29 @@',
      ...body,
      '',
    ].join('\n');
    // Both functions open a paragraph, but the deletions and additions are one
    // run of changed lines, and any cut inside it parts a before from its after.
    expect(splitPatch(patch, 20, FILE)).toBe(patch);
  });

  it('counts both sides of a mixed hunk into each part, and the parts tile the original hunk', () => {
    const body = [
      ' const header = 1;',
      ' ',
      ...fn('a', 14)
        .slice(0, -1)
        .map((l) => `+${l}`),
      '+',
      '-function gone() {',
      '-  return 1;',
      '-}',
      ' ',
      ...fn('b', 14)
        .slice(0, -1)
        .map((l) => `+${l}`),
      ' const footer = 2;',
    ];
    const original = body.filter((l) => l[0] === ' ' || l[0] === '-').length;
    const modified = body.filter((l) => l[0] === ' ' || l[0] === '+').length;
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      `@@ -40,${String(original)} +40,${String(modified)} @@ class Thing {`,
      ...body,
      '',
    ].join('\n');
    const hunks = hunksOf(splitPatch(patch, 20, FILE));

    expect(hunks.length).toBeGreaterThan(1);
    expect(hunks[0]!.header).toBe(
      `@@ -40,${String(hunks[0]!.original.lineCount)} +40,${String(hunks[0]!.modified.lineCount)} @@ (part 1 of ${String(hunks.length)}) class Thing {`,
    );
    for (const side of ['original', 'modified'] as const) {
      let next = 40;
      for (const hunk of hunks) {
        // An empty side is written as the line before it, the way git writes one.
        expect(hunk[side].startLine).toBe(hunk[side].lineCount === 0 ? next - 1 : next);
        next += hunk[side].lineCount;
      }
      expect(next - 40).toBe(side === 'original' ? original : modified);
    }
  });

  it('never leaves a part that only adds a blank line', () => {
    // A hunk inside a file: a test ends in context, one blank line is added,
    // then a long new block follows. The blank would be a part of its own.
    const added = fn('next', 12)
      .slice(0, -1)
      .map((l) => `+${l}`);
    const body = ['   });', ' });', '+', ...added];
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      `@@ -10,2 +10,${String(body.length)} @@`,
      ...body,
      '',
    ].join('\n');
    for (const hunk of hunksOf(splitPatch(patch, 10, FILE))) {
      expect(hunk.modified.lineCount - hunk.original.lineCount).toBeGreaterThan(1);
    }
  });

  it('never leaves a function’s return and closing bracket as a part of their own', () => {
    const source = ['function f() {', ...steps(0), '', ...steps(8), '', '  return v15;', '}'];
    const parts = hunksOf(splitPatch(newFile(source), 10, FILE));

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.at(-1)!.modified.lineCount).toBeGreaterThan(3);
    expect(parts.reduce((sum, h) => sum + h.modified.lineCount, 0)).toBe(source.length);
  });

  it('carries each part’s number onto the hunk a review stores, and none onto a whole one', () => {
    const split = hunksOf(splitPatch(newFile([...fn('a', 15), ...fn('b', 15)]), 20, FILE));
    expect(split.map((hunk) => toResolvedHunk(hunk).part)).toEqual([
      { part: 1, of: 2 },
      { part: 2, of: 2 },
    ]);
    const [whole] = hunksOf(newFile(fn('a', 5)));
    expect(toResolvedHunk(whole!)).not.toHaveProperty('part');
  });

  it('reads a hunk by its header’s counts, so an empty line in it is a blank context line', () => {
    // diff.suppressBlankEmpty: git writes each blank context line as an empty line.
    const first = fn('a', 12)
      .slice(0, -1)
      .map((l) => `+${l}`);
    const second = fn('b', 12)
      .slice(0, -1)
      .map((l) => `+${l}`);
    const body = [' const header = 1;', '', ...first, '', ...second, ' const footer = 2;'];
    const added = first.length + second.length;
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      `@@ -40,4 +40,${String(4 + added)} @@`,
      ...body,
      '@@ -90,1 +90,1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');
    const hunks = hunksOf(splitPatch(patch, 20, FILE));

    expect(hunks.map((h) => h.header)).toEqual([
      '@@ -40,3 +40,17 @@ (part 1 of 2)',
      '@@ -43,1 +57,15 @@ (part 2 of 2)',
      '@@ -90,1 +90,1 @@',
    ]);
  });

  it('refuses a hunk whose body does not match its header’s counts', () => {
    const patch = ['diff --git a/x.ts b/x.ts', '@@ -1,4 +1,4 @@', ' a', '-b', '+c', ''].join('\n');
    expect(() => splitPatch(patch, 20, FILE)).toThrow(/does not match its counts|ends before/);
  });

  it('keeps git’s no-newline marker with the line it is about', () => {
    const source = [...fn('a', 20), ...fn('b', 20).slice(0, -1)];
    const patch = newFile(source).replace(/\n$/, '\n\\ No newline at end of file\n');
    const split = splitPatch(patch, 20, FILE);
    expect(split).toMatch(/\+}\n\\ No newline at end of file\n$/);
    expect(hunksOf(split)).toHaveLength(2);
  });

  it('leaves a hunk with no paragraph to start a part at as one hunk', () => {
    const source = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const patch = newFile(source);
    expect(splitPatch(patch, 20, FILE)).toBe(patch);
  });

  it('splits each large hunk of a file on its own and leaves the rest', () => {
    const big = fn('a', 20)
      .concat(fn('b', 20))
      .slice(0, -1)
      .map((l) => `+${l}`);
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-small',
      '+tiny',
      `@@ -100,0 +100,${String(big.length)} @@`,
      ...big,
      '',
    ].join('\n');
    expect(hunksOf(splitPatch(patch, 20, FILE)).map((h) => h.header)).toEqual([
      '@@ -1,1 +1,1 @@',
      '@@ -100,0 +100,23 @@ (part 1 of 2)',
      '@@ -100,0 +123,22 @@ (part 2 of 2)',
    ]);
  });
});

describe('splitPatch on a test file', () => {
  const TEST_FILE = 'src/x.test.ts';

  /** A case of about a dozen lines, with blank lines between its arrange, act and assert. */
  function testCase(name: string, indent = '  ', runner = 'it'): string[] {
    return [
      `${indent}${runner}('${name}', () => {`,
      ...['a', 'b', 'c', 'd'].map((v) => `${indent}  const ${v} = make('${v}');`),
      '',
      ...['a', 'b', 'c'].map((v) => `${indent}  act(${v});`),
      '',
      `${indent}  expect(d).toBe(1);`,
      `${indent}});`,
    ];
  }

  /** The first line of each part, to see where the cuts fell. */
  function partOpenings(split: string): string[] {
    const lines = split.split('\n');
    return lines.flatMap((line, i) => (line.startsWith('@@') ? [lines[i + 1]!.slice(1)] : []));
  }

  const suite = [
    "import { it } from 'vitest';",
    '',
    "describe('x', () => {",
    ...testCase('a'),
    '',
    ...testCase('b'),
    '',
    ...testCase('c'),
    '});',
  ];

  it("cuts only between cases, a suite's opening line going with its first case when nothing comes before it", () => {
    expect(partOpenings(splitPatch(newFile(suite), 10, TEST_FILE))).toEqual([
      "import { it } from 'vitest';",
      "  it('b', () => {",
      "  it('c', () => {",
    ]);
  });

  it("keeps a suite's setup apart from its cases, the opening line going with the setup", () => {
    const withSetup = [
      "describe('x', () => {",
      "  const NAME = 'x';",
      '',
      '  function arrange() {',
      ...Array.from({ length: 8 }, (_, n) => `    prepare${String(n)}();`),
      '  }',
      '',
      ...testCase('a'),
      '',
      ...testCase('b'),
      '});',
    ];
    expect(partOpenings(splitPatch(newFile(withSetup), 10, TEST_FILE))).toEqual([
      "describe('x', () => {",
      "  it('a', () => {",
      "  it('b', () => {",
    ]);
  });

  it('cuts the same lines inside the cases in a file that is not a test', () => {
    const openings = partOpenings(splitPatch(newFile(suite), 10, FILE));
    expect(openings).toContain('    act(a);');
  });

  it('cuts between cases with no blank line between them', () => {
    const packed = ["describe('x', () => {", ...testCase('a'), ...testCase('b'), '});'];
    expect(partOpenings(splitPatch(newFile(packed), 10, TEST_FILE))).toEqual([
      "describe('x', () => {",
      "  it('b', () => {",
    ]);
  });

  it('keeps a case over the target whole, and a hook too', () => {
    const long = [
      "describe('x', () => {",
      ...testCase('setup', '  ', 'beforeEach'),
      '',
      "  it('runs long', () => {",
      ...Array.from({ length: 4 }, (_, k) => [
        ...[0, 1, 2, 3].map((n) => `    step${String(k)}${String(n)}();`),
        '',
      ]).flat(),
      '    expect(done).toBe(true);',
      '  });',
      '});',
    ];
    expect(partOpenings(splitPatch(newFile(long), 10, TEST_FILE))).toEqual([
      "describe('x', () => {",
      "  it('runs long', () => {",
    ]);
  });

  it('cuts a nested suite between its cases, its own opening line kept with the first', () => {
    const nested = [
      "describe('outer', () => {",
      ...testCase('a'),
      '',
      "  describe.each([1, 2])('inner %i', (n) => {",
      ...testCase('b', '    ', 'it.only'),
      '',
      ...testCase('c', '    ', 'test'),
      '  });',
      '});',
    ];
    expect(partOpenings(splitPatch(newFile(nested), 10, TEST_FILE))).toEqual([
      "describe('outer', () => {",
      "  describe.each([1, 2])('inner %i', (n) => {",
      "    test('c', () => {",
    ]);
  });

  it('falls back to paragraphs in a hunk that starts inside a case', () => {
    const body = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((v) => `+    const ${v} = make('${v}');`),
      '+',
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((v) => `+    act(${v});`),
    ];
    const patch = [
      'diff --git a/src/x.test.ts b/src/x.test.ts',
      '--- a/src/x.test.ts',
      '+++ b/src/x.test.ts',
      `@@ -10,0 +11,${String(body.length)} @@`,
      ...body,
      '',
    ].join('\n');
    expect(partOpenings(splitPatch(patch, 10, TEST_FILE))).toEqual([
      "    const a = make('a');",
      '    act(a);',
    ]);
  });
});
