import { describe, expect, it } from 'vitest';
import { listFiles, readSource, report } from './helpers';

/**
 * Diagrams are painted in SVG, where it is unusually easy to type a colour
 * straight into an attribute — `stroke="#888"` looks like nothing at all in a
 * file full of coordinates, and it is invisible to the palette guardrail
 * because it never reaches a token.
 *
 * Every colour in a diagram therefore has to come from `token()`, the same
 * rule the rest of the reader follows, so that the two schemes and the
 * contrast arithmetic keep applying to the one part of the page drawn by
 * hand. `none`, `transparent` and `currentColor` are not colours in this
 * sense and are allowed.
 */
const DIAGRAM_SOURCES = ['src/web/components/narrative/diagram/**/*.{ts,tsx}'];

describe('guardrail: diagram colour', () => {
  it('never writes a literal colour', () => {
    const files = listFiles(DIAGRAM_SOURCES);
    const literal = /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\(|\bcolor-mix\(/;
    const violations = files.filter((file) => literal.test(readSource(file)));
    expect(report(violations)).toBe('');
  });

  it('names a colour only through token(), never a raw CSS variable', () => {
    const files = listFiles(DIAGRAM_SOURCES);
    const violations = files.filter((file) => /var\(--er-/.test(readSource(file)));
    expect(report(violations)).toBe('');
  });

  it('sets fill and stroke from an expression, not a colour word', () => {
    // `fill="white"` and friends: a named colour is a literal by another name.
    const files = listFiles(DIAGRAM_SOURCES);
    const named =
      /(?:fill|stroke|borderTopColor|background)=["'](?!none|transparent|currentColor)[a-z]/;
    const violations = files.filter((file) => named.test(readSource(file)));
    expect(report(violations)).toBe('');
  });
});
