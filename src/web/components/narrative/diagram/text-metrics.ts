import { CAPTION_TYPE, FONT_SIZES } from '@/web/theme/tokens';

/**
 * Estimated text widths, because diagrams server-render.
 *
 * dagre is pure JavaScript and lays out happily on the server, which puts the
 * SVG in the initial HTML — no layout flash, and it works with JavaScript off.
 * The price is that the server cannot measure a string: there is no canvas and
 * no font. So widths are estimated from character classes and the boxes are
 * padded generously, rather than measured and fitted tightly.
 *
 * The estimate only has to be good enough that a label does not overflow its
 * box. It errs wide on purpose: a node slightly larger than its text costs a
 * little space, and a node slightly smaller clips a word.
 */
const px = (value: string): number => Number.parseInt(value, 10);

/** Diagrams obey the type scale like everything else, and never go below it. */
export const DIAGRAM_TYPE = {
  /** Node and participant labels. */
  node: { size: px(FONT_SIZES.sm), lineHeight: 17 },
  /** Edge labels, group labels, markers. */
  edge: { size: px(FONT_SIZES.xs), lineHeight: 14 },
} as const;

const NARROW = new Set(`ijltfrI.,:;'"|!()[]{}\`-`);
const WIDE = new Set('MWmw@%');

function charWidth(char: string, size: number): number {
  if (NARROW.has(char)) return size * 0.32;
  if (WIDE.has(char)) return size * 0.85;
  if (char >= 'A' && char <= 'Z') return size * 0.66;
  if (char === ' ') return size * 0.28;
  return size * 0.53;
}

export function estimateTextWidth(text: string, size: number): number {
  let total = 0;
  for (const char of text) total += charWidth(char, size);
  return total;
}

/**
 * Break a label across at most `maxLines`, on word boundaries where it can and
 * mid-word where a single word is longer than the line. The last line is
 * ellipsised if the text runs past the limit — the schema caps label length,
 * so this is a backstop rather than the normal path.
 */
export function wrapLabel(
  text: string,
  maxWidth: number,
  size: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  let index = 0;

  for (; index < words.length; index += 1) {
    const word = words[index] as string;
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (line.length === 0 || estimateTextWidth(candidate, size) <= maxWidth) {
      // A single word wider than the line still starts one; it is cut below.
      line = candidate;
      continue;
    }
    // No room for another line, so the rest of the words are lost.
    if (lines.length + 1 >= maxLines) break;
    lines.push(line);
    line = word;
  }
  lines.push(line);

  /*
   * Whether words were left over matters as much as fitting the ones that
   * were kept. An earlier version stopped at the line limit and returned what
   * fitted, which silently dropped the tail of a label and gave the reader no
   * sign it had happened — a truncated node label that looks complete is worse
   * than one that plainly says it is cut.
   */
  const truncated = index < words.length;

  return lines.map((entry, position) => {
    const mustCut = position === lines.length - 1 && truncated;
    if (!mustCut && estimateTextWidth(entry, size) <= maxWidth) return entry;
    let out = entry;
    while (out.length > 0 && estimateTextWidth(`${out}…`, size) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out.trimEnd()}…`;
  });
}

/**
 * Width of a string drawn in the caption style: uppercase, at caption size,
 * with its letter-spacing. Group labels are painted this way, and uppercase
 * plus tracking is a good deal wider than the same word in body type.
 */
export function estimateCaptionWidth(text: string): number {
  const size = px(CAPTION_TYPE.size);
  const tracking = Number.parseFloat(CAPTION_TYPE.tracking) * size;
  const upper = text.toUpperCase();
  return estimateTextWidth(upper, size) + tracking * [...upper].length;
}

/** A caption-style label cut with an ellipsis to fit `maxWidth`, or unchanged if it fits. */
export function fitCaption(text: string, maxWidth: number): string {
  if (estimateCaptionWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 0 && estimateCaptionWidth(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** The width a wrapped label actually occupies. */
export function widestLine(lines: readonly string[], size: number): number {
  return lines.reduce((max, line) => Math.max(max, estimateTextWidth(line, size)), 0);
}
