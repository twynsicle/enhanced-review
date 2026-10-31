import { z } from 'zod';
import { serializeJson } from '../../review/bundle-html.ts';
import { DiagramSchema } from '../../review/diagram.ts';

/**
 * The diagram eval's contact sheet: every diagram of a sweep, or of two
 * sweeps one band above the other, branch by branch, beside what each
 * branch deserves. It travels inside the sheet page the way a review's
 * bundle travels inside the report, through one JSON script element.
 *
 * The eval writes it in Node, so this file imports relatively, with
 * extensions, rather than through the report's `@/` alias.
 */
export const SHEET_ELEMENT_ID = 'er-sheet';

const OPEN = `<script id="${SHEET_ELEMENT_ID}" type="application/json">`;
const CLOSE = '</script>';

/** The empty element as the sheet's `index.html` spells it. */
export const SHEET_PLACEHOLDER = `${OPEN}${CLOSE}`;

export const SheetSampleSchema = z.object({
  sample: z.number().int().positive(),
  /** The sample's review.html relative to the sheet; null when er wrote none. */
  href: z.string().nullable(),
  /** The tail of er's output when it wrote no review. */
  failure: z.string().nullable(),
  onTarget: z.boolean(),
  /** What was drawn against what was deserved, in one line. */
  verdict: z.string(),
  /** The tier 0 counts, in one line. */
  figures: z.string(),
  diagrams: z.array(
    z.object({
      /** `overview`, or the title of the chapter that carries it. */
      where: z.string(),
      diagram: DiagramSchema,
    }),
  ),
});
export type SheetSample = z.infer<typeof SheetSampleSchema>;

export const SheetBranchSchema = z.object({
  name: z.string(),
  title: z.string(),
  deserves: z.string(),
  question: z.string(),
  mustName: z.array(z.string()),
  mustReach: z.array(z.string()),
  /** One band per sweep, in the sheet's sweep order. */
  bands: z.array(z.array(SheetSampleSchema)),
});
export type SheetBranch = z.infer<typeof SheetBranchSchema>;

export const ContactSheetSchema = z.object({
  sweeps: z.array(
    z.object({
      /** The results folder's stamp. */
      stamp: z.string(),
      /** The model, its samples and what it cost, in one line. */
      summary: z.string(),
    }),
  ),
  branches: z.array(SheetBranchSchema),
});
export type ContactSheet = z.infer<typeof ContactSheetSchema>;

/** Fills the placeholder, which must appear exactly once. */
export function injectSheet(html: string, sheet: ContactSheet): string {
  const at = html.indexOf(SHEET_PLACEHOLDER);
  if (at === -1 || html.includes(SHEET_PLACEHOLDER, at + 1)) {
    throw new Error(`expected exactly one ${SHEET_PLACEHOLDER} in the sheet page`);
  }
  return (
    html.slice(0, at) +
    OPEN +
    serializeJson(sheet) +
    CLOSE +
    html.slice(at + SHEET_PLACEHOLDER.length)
  );
}

export function readEmbeddedSheet(
  text: string | null | undefined,
): { ok: true; sheet: ContactSheet } | { ok: false; message: string } {
  if (!text?.trim()) return { ok: false, message: 'This page carries no contact sheet.' };
  const parsed = ContactSheetSchema.safeParse(JSON.parse(text));
  return parsed.success
    ? { ok: true, sheet: parsed.data }
    : { ok: false, message: `The contact sheet does not parse: ${parsed.error.message}` };
}
