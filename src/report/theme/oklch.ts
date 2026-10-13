/**
 * The tokens are written in `oklch()`, which CSS reads but Monaco's theme
 * data does not: a theme rule takes a bare `RRGGBB`. This is the one
 * conversion, shared with the palette guardrail's contrast arithmetic so that
 * what is checked and what is painted are the same numbers.
 */

/** Parses the `oklch(L C H)` form the token maps are written in. */
export function parseOklch(value: string): [number, number, number] {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`not an oklch() value: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Linear-light sRGB, before clamping — out-of-range means out of gamut. */
export function oklchToLinearRgb(l: number, c: number, h: number): [number, number, number] {
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

/** An `oklch()` token as six lowercase hex digits with no `#`, as Monaco's theme rules take it. */
export function oklchToHex(value: string): string {
  return oklchToLinearRgb(...parseOklch(value))
    .map((linear) => {
      const clamped = Math.max(0, Math.min(1, linear));
      const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
}
