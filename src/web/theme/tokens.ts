/**
 * Editorial Iris — the app's semantic colour tokens, ported one-for-one from
 * the previous app's `globals.css` (kept at `legacy/globals.css`).
 *
 * Cobalt (hue 240) is the "before / current state" accent and the primary
 * chrome colour; mint (hue 160) is the "after / new state / approved"
 * counterpart. Insight kinds (risk / praise / suggestion / question) each pick
 * a hue. Values are oklch strings exactly as the baseline rendered them.
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
  'praise',
  'praise-soft',
  'suggestion',
  'suggestion-soft',
  'question',
  'question-soft',
  'add',
  'del',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type TokenMap = Record<TokenName, string>;

export const lightTokens: TokenMap = {
  background: 'oklch(0.985 0.004 245)',
  foreground: 'oklch(0.2 0.02 245)',
  card: 'oklch(1 0 0)',
  'card-foreground': 'oklch(0.2 0.02 245)',
  popover: 'oklch(1 0 0)',
  'popover-foreground': 'oklch(0.2 0.02 245)',
  primary: 'oklch(0.52 0.18 240)',
  'primary-foreground': 'oklch(0.985 0.004 245)',
  secondary: 'oklch(0.96 0.04 240)',
  'secondary-foreground': 'oklch(0.32 0.16 240)',
  muted: 'oklch(0.95 0.008 245)',
  'muted-foreground': 'oklch(0.5 0.02 245)',
  accent: 'oklch(0.96 0.04 240)',
  'accent-foreground': 'oklch(0.32 0.16 240)',
  destructive: 'oklch(0.55 0.18 35)',
  border: 'oklch(0.91 0.012 245)',
  input: 'oklch(0.91 0.012 245)',
  ring: 'oklch(0.52 0.18 240)',
  'surface-2': 'oklch(0.97 0.008 245)',
  subtle: 'oklch(0.66 0.015 245)',
  before: 'oklch(0.6 0.21 245)',
  'before-soft': 'oklch(0.96 0.04 240)',
  'before-ink': 'oklch(0.32 0.16 240)',
  after: 'oklch(0.64 0.18 165)',
  'after-soft': 'oklch(0.94 0.05 160)',
  'after-ink': 'oklch(0.32 0.13 160)',
  risk: 'oklch(0.62 0.21 30)',
  'risk-soft': 'oklch(0.95 0.05 35)',
  praise: 'oklch(0.64 0.18 165)',
  'praise-soft': 'oklch(0.94 0.05 160)',
  suggestion: 'oklch(0.68 0.17 80)',
  'suggestion-soft': 'oklch(0.95 0.06 80)',
  question: 'oklch(0.6 0.21 245)',
  'question-soft': 'oklch(0.96 0.04 240)',
  add: 'oklch(0.64 0.18 165)',
  del: 'oklch(0.62 0.21 30)',
};

export const darkTokens: TokenMap = {
  background: 'oklch(0.17 0.014 245)',
  foreground: 'oklch(0.97 0.005 245)',
  card: 'oklch(0.21 0.016 245)',
  'card-foreground': 'oklch(0.97 0.005 245)',
  popover: 'oklch(0.21 0.016 245)',
  'popover-foreground': 'oklch(0.97 0.005 245)',
  primary: 'oklch(0.72 0.17 240)',
  'primary-foreground': 'oklch(0.17 0.014 245)',
  secondary: 'oklch(0.3 0.1 240)',
  'secondary-foreground': 'oklch(0.86 0.13 240)',
  muted: 'oklch(0.25 0.018 245)',
  'muted-foreground': 'oklch(0.72 0.012 245)',
  accent: 'oklch(0.3 0.1 240)',
  'accent-foreground': 'oklch(0.86 0.13 240)',
  destructive: 'oklch(0.74 0.17 35)',
  border: 'oklch(0.3 0.014 245)',
  input: 'oklch(0.3 0.014 245)',
  ring: 'oklch(0.72 0.17 240)',
  'surface-2': 'oklch(0.25 0.018 245)',
  subtle: 'oklch(0.55 0.015 245)',
  before: 'oklch(0.6 0.21 245)',
  'before-soft': 'oklch(0.3 0.1 240)',
  'before-ink': 'oklch(0.86 0.13 240)',
  after: 'oklch(0.64 0.18 165)',
  'after-soft': 'oklch(0.3 0.1 160)',
  'after-ink': 'oklch(0.88 0.14 160)',
  risk: 'oklch(0.62 0.21 30)',
  'risk-soft': 'oklch(0.28 0.09 35)',
  praise: 'oklch(0.64 0.18 165)',
  'praise-soft': 'oklch(0.28 0.09 160)',
  suggestion: 'oklch(0.68 0.17 80)',
  'suggestion-soft': 'oklch(0.28 0.08 80)',
  question: 'oklch(0.6 0.21 245)',
  'question-soft': 'oklch(0.28 0.08 240)',
  add: 'oklch(0.64 0.18 165)',
  del: 'oklch(0.62 0.21 30)',
};

/** CSS custom property name for a token, e.g. `--er-before-soft`. */
export function tokenVar(name: TokenName): `--er-${TokenName}` {
  return `--er-${name}`;
}

/** `var(--er-<name>)` for use in style props and CSS Modules. */
export function token(name: TokenName): string {
  return `var(${tokenVar(name)})`;
}

/** Page max-width values behind the topbar narrow/wide toggle (`er-layout`). */
export const LAYOUT_WIDTHS = { narrow: '92rem', wide: '110rem' } as const;

/**
 * Corner radius scale. `--radius` was 0.75rem; shadcn derived sm/md/lg/xl from
 * it with 0.6× / 0.8× / 1× / 1.4× multipliers. Mantine gets the same five
 * stops so `radius="lg"` reproduces today's cards.
 */
export const RADII = {
  xs: '0.3rem',
  sm: '0.45rem',
  md: '0.6rem',
  lg: '0.75rem',
  xl: '1.05rem',
} as const;
