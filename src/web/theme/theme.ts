import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  parseThemeColor,
  type VariantColorsResolver,
} from '@mantine/core';
import { RADII } from './tokens';

/**
 * Mantine theme for Editorial Iris. Palette tuples are hex conversions of
 * the oklch ramps so Mantine's own colour maths (contrast, hover shades)
 * can parse them; the exact oklch tokens are applied on top by
 * `css-variables.ts`.
 *
 * Shade anchors (light → dark, index 0–9):
 *   iris[6] = light primary  oklch(0.52 0.18 240)   iris[4] = dark primary  oklch(0.72 0.17 240)
 *   iris[0] = before-soft (light)                    iris[8] = before-ink (light)
 *   mint[5] = after / praise / add                   risk[5] = risk / del
 *   gray  = light-mode neutral ramp (gray[6] = muted-foreground, gray[3] = border)
 *   dark  = dark-mode neutral ramp  (dark[7] = background, dark[6] = card, dark[4] = border)
 */
const iris: MantineColorsTuple = [
  '#dbf6ff',
  '#b4edff',
  '#7adcff',
  '#3fc6ff',
  '#00afff',
  '#0088ee',
  '#0070c4',
  '#0057a5',
  '#00347a',
  '#00315a',
];

const mint: MantineColorsTuple = [
  '#cff6e0',
  '#a9f1ca',
  '#7af4b7',
  '#00d98e',
  '#00c683',
  '#00ac70',
  '#008347',
  '#006933',
  '#004419',
  '#003518',
];

const risk: MantineColorsTuple = [
  '#ffe3d8',
  '#ffc9b6',
  '#ffaa93',
  '#ff896f',
  '#ff7d5c',
  '#e93f2d',
  '#c43b15',
  '#a11e00',
  '#721502',
  '#4c1204',
];

const suggestion: MantineColorsTuple = [
  '#ffebc2',
  '#ffda94',
  '#ffc65a',
  '#f3b01d',
  '#df9d00',
  '#ce8900',
  '#a16200',
  '#804b00',
  '#5a3300',
  '#3d2200',
];

const gray: MantineColorsTuple = [
  '#f1f6fa',
  '#eaeff4',
  '#e3e9ee',
  '#dbe2e9',
  '#c3ccd3',
  '#8b939b',
  '#5a656e',
  '#3f4952',
  '#262f37',
  '#0e171f',
];

const dark: MantineColorsTuple = [
  '#f2f5f8',
  '#ccd2d7',
  '#9fa6ac',
  '#6b737a',
  '#282f35',
  '#1a232a',
  '#12191f',
  '#0a1015',
  '#060a0e',
  '#030507',
];

const SANS_FALLBACK =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const SERIF_FALLBACK = "Georgia, 'Times New Roman', serif";
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const FONT_SANS = `'Inter Tight Variable', ${SANS_FALLBACK}`;
export const FONT_SERIF = `'Source Serif 4', ${SERIF_FALLBACK}`;
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
  headings: {
    fontFamily: FONT_SERIF,
    fontWeight: '600',
  },
  colors: { iris, mint, risk, suggestion, gray, dark },
  primaryColor: 'iris',
  primaryShade: { light: 6, dark: 4 },
  black: '#0e171f',
  white: '#ffffff',
  radius: RADII,
  defaultRadius: 'lg',
  cursorType: 'pointer',
  autoContrast: true,
  fontSmoothing: true,
});
