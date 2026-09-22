/**
 * Editorial Iris — the app's semantic colour tokens.
 *
 * Cobalt (hue 240/245) is the "before / current state" accent and the primary
 * chrome colour; mint (hue 165) is the "after / new state / approved"
 * counterpart. The reader's asides (risk / praise / suggestion / question) each
 * pick a hue, and each comes as a triple: the base for text and rails, `-soft`
 * for a tinted background, `-ink` for text sitting on that `-soft`.
 *
 * **Every token that carries text clears WCAG AA (4.5:1) against both
 * `background` and `card` in its own scheme**, and every value is inside the
 * sRGB gamut so what the browser paints is what the token says. The two
 * schemes therefore hold *different* values for the accents: a mint that
 * reads on an L=0.225 card cannot also read on white, which is why the
 * light ramp is darker and less saturated than the dark one. `subtle` is the
 * one deliberate exception — it is placeholder and decoration only, never
 * body text. Re-check with the palette guardrail after editing any value.
 *
 * Consumed by `css-variables.ts`, which emits each token as `--er-<name>` per
 * colour scheme and maps the relevant ones onto Mantine's own variables.
 */
export const TOKEN_NAMES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'border-strong',
  'input',
  'ring',
  'surface-2',
  'subtle',
  'before',
  'before-soft',
  'before-ink',
  'after',
  'after-soft',
  'after-ink',
  'risk',
  'risk-soft',
  'risk-ink',
  'praise',
  'praise-soft',
  'praise-ink',
  'suggestion',
  'suggestion-soft',
  'suggestion-ink',
  'question',
  'question-soft',
  'question-ink',
  'add',
  'del',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type TokenMap = Record<TokenName, string>;

export const lightTokens: TokenMap = {
  background: 'oklch(0.97 0.006 245)',
  foreground: 'oklch(0.2 0.02 245)',
  card: 'oklch(1 0 0)',
  'card-foreground': 'oklch(0.2 0.02 245)',
  popover: 'oklch(1 0 0)',
  'popover-foreground': 'oklch(0.2 0.02 245)',
  primary: 'oklch(0.515 0.118 240)',
  'primary-foreground': 'oklch(0.99 0.004 245)',
  secondary: 'oklch(0.95 0.026 240)',
  'secondary-foreground': 'oklch(0.32 0.075 240)',
  muted: 'oklch(0.94 0.008 245)',
  'muted-foreground': 'oklch(0.48 0.02 245)',
  accent: 'oklch(0.95 0.026 240)',
  'accent-foreground': 'oklch(0.32 0.075 240)',
  destructive: 'oklch(0.53 0.18 35)',
  border: 'oklch(0.85 0.012 245)',
  'border-strong': 'oklch(0.619 0.015 245)',
  input: 'oklch(0.85 0.012 245)',
  ring: 'oklch(0.515 0.118 240)',
  'surface-2': 'oklch(0.955 0.008 245)',
  subtle: 'oklch(0.6 0.015 245)',
  before: 'oklch(0.515 0.13 245)',
  'before-soft': 'oklch(0.96 0.021 240)',
  'before-ink': 'oklch(0.32 0.075 240)',
  after: 'oklch(0.505 0.107 165)',
  'after-soft': 'oklch(0.94 0.05 160)',
  'after-ink': 'oklch(0.32 0.074 160)',
  risk: 'oklch(0.545 0.22 30)',
  'risk-soft': 'oklch(0.95 0.025 35)',
  'risk-ink': 'oklch(0.35 0.145 30)',
  praise: 'oklch(0.505 0.107 165)',
  'praise-soft': 'oklch(0.94 0.05 160)',
  'praise-ink': 'oklch(0.32 0.074 160)',
  suggestion: 'oklch(0.52 0.108 80)',
  'suggestion-soft': 'oklch(0.95 0.046 80)',
  'suggestion-ink': 'oklch(0.38 0.08 80)',
  question: 'oklch(0.515 0.13 245)',
  'question-soft': 'oklch(0.96 0.021 240)',
  'question-ink': 'oklch(0.32 0.075 240)',
  add: 'oklch(0.505 0.107 165)',
  del: 'oklch(0.545 0.22 30)',
};

export const darkTokens: TokenMap = {
  background: 'oklch(0.155 0.014 245)',
  foreground: 'oklch(0.97 0.005 245)',
  card: 'oklch(0.225 0.016 245)',
  'card-foreground': 'oklch(0.97 0.005 245)',
  popover: 'oklch(0.225 0.016 245)',
  'popover-foreground': 'oklch(0.97 0.005 245)',
  primary: 'oklch(0.72 0.162 240)',
  'primary-foreground': 'oklch(0.155 0.014 245)',
  secondary: 'oklch(0.32 0.075 240)',
  'secondary-foreground': 'oklch(0.86 0.077 240)',
  muted: 'oklch(0.27 0.018 245)',
  'muted-foreground': 'oklch(0.74 0.012 245)',
  accent: 'oklch(0.32 0.075 240)',
  'accent-foreground': 'oklch(0.86 0.077 240)',
  destructive: 'oklch(0.74 0.161 35)',
  border: 'oklch(0.37 0.014 245)',
  'border-strong': 'oklch(0.546 0.015 245)',
  input: 'oklch(0.37 0.014 245)',
  ring: 'oklch(0.72 0.162 240)',
  'surface-2': 'oklch(0.27 0.018 245)',
  subtle: 'oklch(0.58 0.015 245)',
  before: 'oklch(0.68 0.16 245)',
  'before-soft': 'oklch(0.32 0.075 240)',
  'before-ink': 'oklch(0.86 0.077 240)',
  after: 'oklch(0.7 0.147 165)',
  'after-soft': 'oklch(0.3 0.07 160)',
  'after-ink': 'oklch(0.88 0.14 160)',
  risk: 'oklch(0.68 0.19 30)',
  'risk-soft': 'oklch(0.3 0.09 35)',
  'risk-ink': 'oklch(0.86 0.076 30)',
  praise: 'oklch(0.7 0.147 165)',
  'praise-soft': 'oklch(0.3 0.07 160)',
  'praise-ink': 'oklch(0.88 0.14 160)',
  suggestion: 'oklch(0.75 0.15 80)',
  'suggestion-soft': 'oklch(0.3 0.065 80)',
  'suggestion-ink': 'oklch(0.88 0.12 85)',
  question: 'oklch(0.68 0.16 245)',
  'question-soft': 'oklch(0.3 0.071 240)',
  'question-ink': 'oklch(0.86 0.077 240)',
  add: 'oklch(0.7 0.147 165)',
  del: 'oklch(0.68 0.19 30)',
};

/**
 * Syntax colours for `highlight.js` output in markdown code fences: the
 * GitHub light/dark themes' fifteen colours, emitted as `--er-hljs-<name>`
 * per scheme so fenced code follows the colour scheme instead of shipping a
 * vendor stylesheet. The block background comes from the palette, not
 * GitHub's `#0d1117`.
 */
export const HLJS_TOKEN_NAMES = [
  'fg',
  'bg',
  'keyword',
  'entity',
  'constant',
  'string',
  'variable',
  'comment',
  'tag',
  'heading',
  'list',
  'addition',
  'addition-bg',
  'deletion',
  'deletion-bg',
] as const;

export type HljsTokenName = (typeof HLJS_TOKEN_NAMES)[number];
export type HljsTokenMap = Record<HljsTokenName, string>;

export const hljsLightTokens: HljsTokenMap = {
  fg: '#24292e',
  bg: 'oklch(0.965 0.006 245)',
  keyword: '#d73a49',
  entity: '#6f42c1',
  constant: '#005cc5',
  string: '#032f62',
  variable: '#e36209',
  comment: '#6a737d',
  tag: '#22863a',
  heading: '#005cc5',
  list: '#735c0f',
  addition: '#22863a',
  'addition-bg': '#f0fff4',
  deletion: '#b31d28',
  'deletion-bg': '#ffeef0',
};

export const hljsDarkTokens: HljsTokenMap = {
  fg: '#c9d1d9',
  bg: 'oklch(0.13 0.012 245)',
  keyword: '#ff7b72',
  entity: '#d2a8ff',
  constant: '#79c0ff',
  string: '#a5d6ff',
  variable: '#ffa657',
  comment: '#8b949e',
  tag: '#7ee787',
  heading: '#1f6feb',
  list: '#f2cc60',
  addition: '#aff5b4',
  'addition-bg': '#033a16',
  deletion: '#ffdcd7',
  'deletion-bg': '#67060c',
};

/** CSS custom property name for a syntax token, e.g. `--er-hljs-keyword`. */
export function hljsVar(name: HljsTokenName): `--er-hljs-${HljsTokenName}` {
  return `--er-hljs-${name}`;
}

/** CSS custom property name for a token, e.g. `--er-before-soft`. */
export function tokenVar(name: TokenName): `--er-${TokenName}` {
  return `--er-${name}`;
}

/** `var(--er-<name>)` for use in style props and CSS Modules. */
export function token(name: TokenName): string {
  return `var(${tokenVar(name)})`;
}

/**
 * Page max-width values behind the reader's width toggle (`er-layout`).
 *
 * Both stops are for the reader, because the reader is the only page whose
 * content — a side-by-side Monaco diff — gets better the more room it has.
 * `full` is deliberately uncapped rather than a large `rem` ceiling: the
 * reading measure is what keeps prose readable, so there is nothing left for a
 * ceiling to protect, and a diff is never worse for being wider.
 */
export const LAYOUT_WIDTHS = { wide: '110rem', full: '100%' } as const;

/*
 * The reader's navigation column, in pixels: the width it opens at and the
 * stops the drag handle clamps between. A token rather than a constant beside
 * the handle because two things need the default and cannot ask each other
 * for it — the stylesheet's starting value and the store.
 */
export const SIDEBAR_WIDTHS = { default: 256, min: 208, max: 420 } as const;

/**
 * The topbar's height in pixels. Shared with anything that sticks below it —
 * a diff's own filename header, say — so the two can never drift apart.
 */
export const TOPBAR_HEIGHT = 56;

/**
 * Corner radius scale. The base radius is 0.75rem, with sm/md/lg/xl derived
 * from it by 0.6× / 0.8× / 1× / 1.4× multipliers — the same five stops the
 * previous UI used, so `radius="lg"` reproduces the same cards.
 */
export const RADII = {
  xs: '0.3rem',
  sm: '0.45rem',
  md: '0.6rem',
  lg: '0.75rem',
  xl: '1.05rem',
} as const;

/**
 * The type scale — six steps, and the only sizes the UI is allowed to use.
 *
 * Five are Mantine's own `fontSizes` keys, so `fz="sm"` and every component
 * default resolves here; `DISPLAY` is the page-title step, applied directly
 * because Mantine's scale stops at `xl`. Steps are far enough apart to read
 * as rank — the previous UI had twelve sizes with eight of them between 10px
 * and 15px, differences too small to signal hierarchy and large enough to
 * read as noise.
 *
 *   xs 11  uppercase labels, eyebrows, counts   (see components/caption.tsx)
 *   sm 13  metadata, secondary and helper lines
 *   md 15  body prose, insight text, table cells
 *   lg 19  card and insight titles
 *   xl 28  stat figures, file headlines
 *   DISPLAY 40  page and chapter titles
 */
export const FONT_SIZES = {
  xs: '11px',
  sm: '13px',
  md: '15px',
  lg: '19px',
  xl: '28px',
} as const;

/** Page- and chapter-title size; above Mantine's `xl` step. */
export const DISPLAY_SIZE = 40;

/** Line heights paired with `FONT_SIZES`; prose reads at `md`. */
export const LINE_HEIGHTS = {
  xs: '1.4',
  sm: '1.5',
  md: '1.6',
  lg: '1.35',
  xl: '1.15',
} as const;

/**
 * The one uppercase-label treatment. Every eyebrow, caption, field label and
 * section rule in the app uses these values through `components/caption.tsx`
 * and varies only by colour — nine near-identical treatments differing by
 * half a pixel and 0.04em of tracking is noise, not hierarchy.
 */
export const CAPTION_TYPE = {
  size: FONT_SIZES.xs,
  weight: 600,
  tracking: '0.12em',
} as const;
