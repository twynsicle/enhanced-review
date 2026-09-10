import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  parseThemeColor,
  type VariantColorsResolver,
} from '@mantine/core';
import { FONT_SIZES, LINE_HEIGHTS, RADII } from './tokens';

/**
 * Mantine theme for Editorial Iris. Palette tuples are hex renderings of the
 * oklch ramps in `tokens.ts` so Mantine's own colour maths (contrast, hover
 * shades) can parse them; the exact tokens are applied on top by
 * `css-variables.ts`. Each tuple is generated from one hue with the maximum
 * in-gamut chroma at each step, and anchored so the indices Mantine reaches
 * for land on the same colours as the tokens:
 *
 *   iris[6]  = light primary   iris[4] = dark primary
 *   mint[5]  = after / praise / add     risk[5] = risk / del
 *   gray[3]  = light border    gray[6] = light muted-foreground
 *   dark[7]  = dark background dark[6] = dark card
 *   dark[5]  = dark border     dark[4] = dark border-strong
 *
 * Typography is two families — sans for everything, mono for identifiers,
 * paths, SHAs and code. There is no display serif: a second text face at the
 * same size as the first reads as an inconsistency rather than a rank, and
 * the reader was rendering prose in both.
 */
const iris: MantineColorsTuple = [
  '#e6f4ff',
  '#cce9ff',
  '#a3d8ff',
  '#76c7ff',
  '#11afff',
  '#0292d7',
  '#006fa4',
  '#005b88',
  '#004264',
  '#002f4a',
];

const mint: MantineColorsTuple = [
  '#ddfaec',
  '#c0f2db',
  '#95e5c2',
  '#64d7aa',
  '#03c18d',
  '#00a275',
  '#00815d',
  '#006548',
  '#004933',
  '#003523',
];

const risk: MantineColorsTuple = [
  '#ffedea',
  '#ffdbd5',
  '#ffbfb4',
  '#ffa192',
  '#ff735f',
  '#f53321',
  '#cd0b00',
  '#a30500',
  '#780000',
  '#590000',
];

const suggestion: MantineColorsTuple = [
  '#fff0d8',
  '#fae1b7',
  '#f1cb8a',
  '#e8b458',
  '#d59801',
  '#b27e00',
  '#8f6500',
  '#704e00',
  '#523800',
  '#3c2700',
];

const gray: MantineColorsTuple = [
  '#f0f8ff',
  '#e6eef5',
  '#d8dfe6',
  '#c8cfd5',
  '#a8afb5',
  '#80878d',
  '#585e64',
  '#42484e',
  '#2e3439',
  '#161b20',
];

const dark: MantineColorsTuple = [
  '#eef6fe',
  '#d7dfe7',
  '#b7bfc6',
  '#8b939a',
  '#60676e',
  '#3a4147',
  '#161d22',
  '#070d12',
  '#03060a',
  '#010305',
];

const SANS_FALLBACK =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const FONT_SANS = `'Inter Tight Variable', ${SANS_FALLBACK}`;
export const FONT_MONO = `'JetBrains Mono Variable', ${MONO_FALLBACK}`;

/**
 * The primary shade differs per scheme (iris[6] light, iris[4] dark) and the
 * dark one is bright enough to want dark text, as the baseline renders.
 * Mantine's `autoContrast` computes a filled button's text colour at render
 * time without knowing the scheme, so for the primary colour we defer to
 * `--mantine-primary-color-contrast`, which Mantine emits per scheme.
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const defaults = defaultVariantColorsResolver(input);
  const parsed = parseThemeColor({
    color: input.color || input.theme.primaryColor,
    theme: input.theme,
  });
  const isPrimary =
    parsed.isThemeColor && parsed.color === input.theme.primaryColor && parsed.shade === undefined;
  if (input.variant === 'filled' && isPrimary) {
    return { ...defaults, color: 'var(--mantine-primary-color-contrast)' };
  }
  return defaults;
};

export const theme = createTheme({
  variantColorResolver,
  fontFamily: FONT_SANS,
  fontFamilyMonospace: FONT_MONO,
  fontSizes: FONT_SIZES,
  lineHeights: LINE_HEIGHTS,
  headings: {
    fontFamily: FONT_SANS,
    fontWeight: '600',
    sizes: {
      h1: { fontSize: FONT_SIZES.xl, lineHeight: '1.15' },
      h2: { fontSize: FONT_SIZES.lg, lineHeight: '1.3' },
      h3: { fontSize: FONT_SIZES.md, lineHeight: '1.4' },
      h4: { fontSize: FONT_SIZES.sm, lineHeight: '1.45' },
      h5: { fontSize: FONT_SIZES.sm, lineHeight: '1.45' },
      h6: { fontSize: FONT_SIZES.xs, lineHeight: '1.4' },
    },
  },
  colors: { iris, mint, risk, suggestion, gray, dark },
  primaryColor: 'iris',
  primaryShade: { light: 6, dark: 4 },
  black: '#161b20',
  white: '#ffffff',
  radius: RADII,
  defaultRadius: 'lg',
  cursorType: 'pointer',
  autoContrast: true,
  fontSmoothing: true,
});
