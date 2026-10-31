import { CAPTION_TYPE, FONT_SIZES } from '@/report/theme/tokens';

/**
 * Estimated text widths, because diagrams lay out during render.
 *
 * dagre is pure JavaScript, so the layout runs as the figure renders and the
 * SVG is there on the first paint — no measuring pass, no layout flash, and
 * the layout is testable in Node, where there is no canvas and no font. The
 * price is that nothing measures a string. So widths are estimated from
 * character classes and the boxes are padded generously, rather than measured
 * and fitted tightly.
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

/** The gap between a node's label and the path beneath it. */
export const PATH_GAP = 3;

/** The height a path line adds to a box: the gap and one line of edge type. */
export const PATH_HEIGHT = PATH_GAP + DIAGRAM_TYPE.edge.lineHeight;

/** What a cut label ends in, and so how a painter knows one was cut. */
const ELLIPSIS = '…';

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
    while (out.length > 0 && estimateTextWidth(`${out}${ELLIPSIS}`, size) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out.trimEnd()}${ELLIPSIS}`;
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
  while (out.length > 0 && estimateCaptionWidth(`${out}${ELLIPSIS}`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}

/**
 * The whole of `label` when `drawn` is only part of it, and undefined when the
 * two say the same thing. A painter hands this to an SVG `<title>`, so the cut
 * is recoverable by hovering.
 *
 * An ellipsis tells a reader a label was cut but not what it was cut from,
 * which is no help at all where it costs the most: a node named after a file
 * can differ from its neighbour only in the part that went, and a diagram
 * comparing two files then labels both of them the same.
 */
export function cutFrom(label: string, drawn: readonly string[]): string | undefined {
  return drawn.some((line) => line.endsWith(ELLIPSIS)) ? label : undefined;
}

/** A monospace glyph is one fixed width, so a path's estimate is a count. */
export function estimateMonoWidth(text: string, size: number): number {
  return [...text].length * size * 0.62;
}

/**
 * The path a grounded node draws beneath its label: the answer to "where is
 * this" for a part named by what it does. None when the label already is the
 * path or its file name, since the line would say it twice.
 */
export function pathLine(label: string, filename: string | undefined): string | undefined {
  if (filename === undefined) return undefined;
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  return label === filename || label === base ? undefined : filename;
}

/**
 * A path cut from the left to fit `maxWidth`, or unchanged if it fits. The
 * file name at the end is what tells two paths apart, so the folders go first.
 */
export function fitPath(path: string, size: number, maxWidth: number): string {
  if (estimateMonoWidth(path, size) <= maxWidth) return path;
  let out = path;
  while (out.length > 0 && estimateMonoWidth(`${ELLIPSIS}${out}`, size) > maxWidth) {
    out = out.slice(1);
  }
  return `${ELLIPSIS}${out}`;
}

/** The width a wrapped label actually occupies. */
export function widestLine(lines: readonly string[], size: number): number {
  return lines.reduce((max, line) => Math.max(max, estimateTextWidth(line, size)), 0);
}
