import { describe, expect, it } from 'vitest';
import {
  darkTokens,
  lightTokens,
  TOKEN_NAMES,
  type TokenMap,
  type TokenName,
} from '../report/theme/tokens.ts';
import { listFiles, readSource, report } from './helpers.ts';

/**
 * Guardrail — the palette keeps its contrast promises, and the UI keeps
 * using the type scale instead of growing one-off sizes again.
 *
 * The colour half is arithmetic, not convention: every token that carries
 * text is checked against both grounds of its own scheme at WCAG AA. It is
 * here rather than beside the theme because the property belongs to the pair
 * of token maps, and because an accent that reads on a dark card silently
 * stops reading when the same value is reused in the light scheme — which is
 * exactly how the previous palette failed.
 */

// --- oklch → sRGB → relative luminance ------------------------------------

/** Parses the `oklch(L C H)` form the token maps are written in. */
function parseOklch(value: string): [number, number, number] {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`not an oklch() value: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Linear-light sRGB, before clamping — out-of-range means out of gamut. */
function toLinearRgb(l: number, c: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

function relativeLuminance(value: string): number {
  const linear = toLinearRgb(...parseOklch(value)).map((channel) =>
    Math.max(0, Math.min(1, channel)),
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function isInGamut(value: string): boolean {
  return toLinearRgb(...parseOklch(value)).every(
    (channel) => channel >= -0.001 && channel <= 1.001,
  );
}

// --- the promises ----------------------------------------------------------

const AA = 4.5;
/** WCAG 1.4.11: boundaries a user must perceive to operate a control. */
const UI_COMPONENT = 3;

/**
 * Tokens used as text. `subtle` is excluded by design — it is placeholder
 * and decoration only, which `no subtle text` below keeps true.
 */
const TEXT_TOKENS: TokenName[] = [
  'foreground',
  'card-foreground',
  'popover-foreground',
  'muted-foreground',
  'primary',
  'destructive',
  'before',
  'after',
  'risk',
  'praise',
  'suggestion',
  'question',
  'add',
  'del',
];

/**
 * Every surface a token can be painted on. `surface-2` and `muted` are as real
 * as the other two — inline code chips, hover fills, tinted rows — and an
 * accent tuned only against `card` fails on them by a couple of tenths, which
 * is exactly how the filter chips and the timeline markers slipped under AA.
 */
const GROUNDS = ['background', 'card', 'surface-2', 'muted'] as const;

/** Kinds whose text sits on the matching `-soft` fill (pills, chips). */
const TINTED_KINDS = ['before', 'after', 'risk', 'praise', 'suggestion', 'question'] as const;

/**
 * The `-soft` tints, treated as grounds in their own right. A tint is a
 * background like any other — the segmented-control track, the timeline's
 * chapter list, an active nav pill — and the tokens above are tuned against
 * the *page* grounds, not against these. In dark, `risk` lands on
 * `before-soft` at 4.01:1 and `before` on its own `before-soft` at 4.40:1,
 * so a component that paints a tint and then reaches for a page-ground
 * colour ships text under AA without any existing assertion noticing.
 */
const TINT_GROUNDS = TINTED_KINDS.map((kind) => `${kind}-soft` as TokenName);

/**
 * The only colours allowed to carry text on a tint: the `-ink` pair, and
 * `foreground` for the rare full-strength line. Deliberately *not*
 * `muted-foreground` or a base accent — that is the rule this file exists to
 * hold, and `no page-ground text colour on a tint` below enforces it in the
 * components as well as in the arithmetic.
 */
const TINT_TEXT_TOKENS: TokenName[] = [
  ...TINTED_KINDS.map((kind) => `${kind}-ink` as TokenName),
  'foreground',
];

const SCHEMES: [string, TokenMap][] = [
  ['light', lightTokens],
  ['dark', darkTokens],
];

describe('guardrail: palette', () => {
  it.each(SCHEMES)('%s: text tokens clear AA on every ground', (_scheme, tokens) => {
    const failures = TEXT_TOKENS.flatMap((name) =>
      GROUNDS.map((ground) => ({ ground, ratio: contrast(tokens[name], tokens[ground]) }))
        .filter(({ ratio }) => ratio < AA)
        .map(({ ground, ratio }) => `${name} on ${ground}: ${ratio.toFixed(2)}:1`),
    );
    expect(failures).toEqual([]);
  });

  it.each(SCHEMES)('%s: each -ink clears AA on its own -soft fill', (_scheme, tokens) => {
    const failures = TINTED_KINDS.map((kind) => ({
      kind,
      ratio: contrast(tokens[`${kind}-ink`], tokens[`${kind}-soft`]),
    }))
      .filter(({ ratio }) => ratio < AA)
      .map(({ kind, ratio }) => `${kind}-ink on ${kind}-soft: ${ratio.toFixed(2)}:1`);
    expect(failures).toEqual([]);
  });

  it.each(SCHEMES)('%s: tint text tokens clear AA on every -soft fill', (_scheme, tokens) => {
    // Cross-kind too: an `-ink` is only ever painted on its own tint today,
    // but the inks all sit on the same side of the lightness axis within a
    // scheme, so holding the whole matrix costs nothing and stops a future
    // tint from being introduced at a lightness the inks cannot carry.
    const failures = TINT_TEXT_TOKENS.flatMap((name) =>
      TINT_GROUNDS.map((ground) => ({ ground, ratio: contrast(tokens[name], tokens[ground]) }))
        .filter(({ ratio }) => ratio < AA)
        .map(({ ground, ratio }) => `${name} on ${ground}: ${ratio.toFixed(2)}:1`),
    );
    expect(failures).toEqual([]);
  });

  it.each(SCHEMES)('%s: an accent reads as a boundary on its own -soft fill', (_scheme, tokens) => {
    // The rails and rings drawn round a tinted pill — the timeline's done
    // marker, the risk pill's border — are the base accent on the matching
    // tint, which is a UI boundary rather than text.
    const failures = TINTED_KINDS.map((kind) => ({
      kind,
      ratio: contrast(tokens[kind], tokens[`${kind}-soft`]),
    }))
      .filter(({ ratio }) => ratio < UI_COMPONENT)
      .map(({ kind, ratio }) => `${kind} on ${kind}-soft: ${ratio.toFixed(2)}:1`);
    expect(failures).toEqual([]);
  });

  it.each(SCHEMES)('%s: border-strong is perceivable against every ground', (_scheme, tokens) => {
    for (const ground of GROUNDS) {
      expect(contrast(tokens['border-strong'], tokens[ground])).toBeGreaterThanOrEqual(
        UI_COMPONENT,
      );
    }
  });

  it.each(SCHEMES)('%s: every token is inside the sRGB gamut', (_scheme, tokens) => {
    const outside = TOKEN_NAMES.filter(
      (name) => tokens[name].startsWith('oklch(') && !isInGamut(tokens[name]),
    );
    expect(outside).toEqual([]);
  });

  it('the two schemes hold their own accent values', () => {
    // Shared accents are how the light scheme came to fail AA: a value tuned
    // for a dark card cannot also read on white.
    const shared = TINTED_KINDS.filter((kind) => lightTokens[kind] === darkTokens[kind]);
    expect(shared).toEqual([]);
  });

  it('no page-ground text colour on a tint', () => {
    // The arithmetic above proves which pairings are safe; this proves the
    // components use them. A component paints a `-soft` fill and then colours
    // the text a few lines below — often on a child element, so the two never
    // share a style block — and nothing connects them but proximity, which is
    // why this is a line scan rather than a style-block one.
    //
    // Only *unconditional* fills are policed. `background: active ?
    // token('before-soft') : token('card')` is the nav-pill shape, where the
    // tint and the `-ink` share one condition and the other branch is on the
    // page ground; reading that correctly needs more than a line scan, so it
    // is left to review. An unconditional fill has no such excuse: every
    // colour under it is on the tint.
    const files = listFiles(
      ['src/report/**/*.{tsx,css}'],
      ['src/report/theme/**', 'src/report/**/*.test.tsx'],
    );
    const violations: string[] = [];

    for (const file of files) {
      const lines = readSource(file).split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        const fill = tintFillOn(line);
        if (fill === null) continue;
        for (const [offset, scanned] of windowFrom(lines, index).entries()) {
          for (const value of colourValues(scanned)) {
            const offender = PAGE_GROUND_TEXT.find((name) => mentionsToken(value, name));
            if (offender === undefined) continue;
            violations.push(
              `${file}:${String(index + offset + 1)} — ${offender} sits on the ${fill} fill ` +
                `opened at line ${String(index + 1)}; use the matching -ink`,
            );
          }
        }
      }
    }
    expect(report(violations)).toBe('');
  });

  it('a CSS rule that paints a tint states the text colour on it', () => {
    // The line scan above only sees one file. A CSS Module paints the fill and
    // the text lands there from JSX a component away — `.riskCard[data-active]`
    // tinted the reader's default-active card while its caption, score label
    // and meter took `token()` colours from `risk-score.tsx`, so nothing in
    // either file said the two met. A rule that changes the ground under its
    // children owns their foreground: declare it, or do not tint.
    const violations = listFiles(['src/report/**/*.module.css'], ['src/report/theme/**']).flatMap(
      (file) =>
        [...readSource(file).matchAll(CSS_RULE)].flatMap((rule) => {
          const [, selector = '', body = ''] = rule;
          const fill = tintFillOn(body.replace(/\n/g, ' '));
          if (fill === null || colourValues(body.replace(/\n/g, ' ')).length > 0) return [];
          return [`${file} — ${selector.trim()} fills with ${fill} but sets no colour`];
        }),
    );
    expect(report(violations)).toBe('');
  });
});

// --- reading the components ------------------------------------------------

/** One flat `selector { … }` block; CSS Modules here nest only in keyframes. */
const CSS_RULE = /([^{}]*)\{([^{}]*)\}/g;

/** How far under a fill a colour is still plausibly painted on it. */
const TINT_SCAN_LINES = 15;

/** `background: token('before-soft')`, `--marker-bg: var(--er-after-soft)`. */
const FILL_PROPERTY = /(?:^|[\s{;,('"])(?:background(?:-color|Color)?|--[\w-]*bg)'?\s*:([^;\n]*)/;

/** Where a colour is set: CSS `color`, Mantine's `c={…}`, a `--…-fg` var. */
const COLOUR_SITES = [
  /(?:^|[\s{;,('"])color'?\s*:([^;\n]*)/g,
  /\bc=\{([^}\n]*)\}/g,
  /(?:^|[\s{;,('"])--[\w-]*(?:fg|color)'?\s*:([^;\n]*)/g,
];

/**
 * Colours that belong on a page ground and nowhere near a tint:
 * `muted-foreground` and every base accent.
 */
const PAGE_GROUND_TEXT: TokenName[] = ['muted-foreground', ...TINTED_KINDS];

/** `token('x')` or `var(--er-x)` — the only two ways a token reaches the DOM. */
function mentionsToken(value: string, name: TokenName): boolean {
  return new RegExp(String.raw`token\(\s*'${name}'|var\(\s*--er-${name}\s*\)`).test(value);
}

/** The tint a line fills with, or null — ternaries and `&&` are left alone. */
function tintFillOn(line: string): TokenName | null {
  const value = FILL_PROPERTY.exec(line)?.[1];
  if (value === undefined) return null;
  if (value.includes('?') || value.includes('&&')) return null;
  return TINT_GROUNDS.find((ground) => mentionsToken(value, ground)) ?? null;
}

/** The fill's line and what follows, stopping at the enclosing block's close. */
function windowFrom(lines: string[], index: number): string[] {
  const scanned: string[] = [];
  for (const line of lines.slice(index, index + TINT_SCAN_LINES)) {
    if (scanned.length > 0 && line.startsWith('}')) break;
    scanned.push(line);
  }
  return scanned;
}

function colourValues(line: string): string[] {
  return COLOUR_SITES.flatMap((pattern) => [...line.matchAll(pattern)].map((match) => match[1]!));
}

describe('guardrail: type scale', () => {
  it('no component sets a font size off the scale', () => {
    const files = listFiles(['src/report/**/*.{tsx,css}'], ['src/report/theme/**']);
    const violations = files.filter((file) => {
      const source = readSource(file);
      // `fz={13}` in TSX, `font-size: 13px` in a CSS Module. Both should be a
      // scale key: fz="sm" / var(--mantine-font-size-sm).
      return /\bfz=\{\d/.test(source) || /font-size:\s*\d+(\.\d+)?px/.test(source);
    });
    expect(report(violations)).toBe('');
  });

  it('uppercase labels go through the Caption component', () => {
    const files = listFiles(
      ['src/report/**/*.tsx'],
      ['src/report/chrome/caption.tsx', 'src/report/**/*.test.tsx'],
    );
    // Positive tracking is the small-caps label signature — `tt="uppercase"`
    // alone is legitimate elsewhere (avatar initials, a capitalised status),
    // and negative tracking is how display sizes are tightened.
    const violations = files.filter((file) => /letterSpacing: '0\.\d+em'/.test(readSource(file)));
    expect(report(violations)).toBe('');
  });
});
