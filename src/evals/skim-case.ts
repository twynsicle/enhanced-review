import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CommitSchema, DiffHunkSchema } from '../cli/context.ts';
import { ReviewFileSchema } from '../review/narrative.ts';

/**
 * A skim-eval case: one whole change, as the prompt stage would show it to
 * the model, with a human's tier for each of its hunks. One change per case,
 * never hunks gathered from several, because a tier depends on the rest of the
 * change — a rename's call sites are skim only beside the rename.
 *
 *   evals/skims/cases/<name>/
 *     case.json      what the prompt shows: title, description, commits, files, the hunk catalog
 *     diff.patch     the change's annotated patch, each hunk's id on a `# H0001` line
 *     labels.jsonl   one line per hunk, the human's tier and category; the only file a person edits,
 *                    and a row is a label only once it carries a category
 */
export const CASES_DIR = path.join('evals', 'skims', 'cases');
export const RESULTS_DIR = path.join('evals', 'skims', 'results');

export const SkimCaseSchema = z.object({
  name: z.string().min(1),
  /** Where the case came from, for whoever labels it. */
  source: z.object({
    folder: z.string(),
    repo: z.string(),
    kind: z.enum(['pr', 'branch', 'staged']),
  }),
  title: z.string(),
  description: z.string().nullable(),
  commits: z.array(CommitSchema),
  /** Every changed file, the skipped ones marked, as the prompt lists them. */
  files: z.array(ReviewFileSchema),
  /** The hunk catalog the prompt shows, facts and all. */
  hunks: z.array(DiffHunkSchema),
});
export type SkimCase = z.infer<typeof SkimCaseSchema>;

/**
 * A label's tier. `either` is a hunk two careful reviewers could tier
 * differently, which the scorer leaves out rather than guessing; `proven` is
 * one the tool settles itself (whitespace or imports only), which the parser
 * makes skim whatever the model says, so the model's answer there is noise.
 */
export const LabelTierSchema = z.enum(['read', 'skim', 'either', 'proven']);
export type LabelTier = z.infer<typeof LabelTierSchema>;

export const LabelSchema = z.object({
  id: z.string().regex(/^H\d{4,}$/),
  /** The hunk's file and header, so a label can be read without the diff open. */
  file: z.string(),
  header: z.string(),
  tier: LabelTierSchema,
  /**
   * What kind of lines these are, free text, grouped by the scorer; the
   * recommended set is in docs/skim-evals.md. A row without one has not been
   * labelled yet: the import seeds the tier from the model, so the category is
   * the one mark that a person has judged the row, and the scorer skips a row
   * without it.
   */
  category: z.string().min(1).optional(),
  /** Why the label is what it is, or the model's own skim reason when seeded. */
  note: z.string().optional(),
});
export type Label = z.infer<typeof LabelSchema>;

export interface CaseFiles {
  name: string;
  folder: string;
  case: string;
  diff: string;
  labels: string;
}

export function caseFiles(root: string, name: string): CaseFiles {
  const folder = path.join(root, CASES_DIR, name);
  return {
    name,
    folder,
    case: path.join(folder, 'case.json'),
    diff: path.join(folder, 'diff.patch'),
    labels: path.join(folder, 'labels.jsonl'),
  };
}

export interface LoadedCase {
  case: SkimCase;
  diff: string;
  labels: Label[];
}

export async function readCase(files: CaseFiles): Promise<LoadedCase> {
  const [caseText, diff, labelText] = await Promise.all([
    readFile(files.case, 'utf8'),
    readFile(files.diff, 'utf8'),
    readFile(files.labels, 'utf8'),
  ]);
  const parsed = SkimCaseSchema.safeParse(JSON.parse(caseText));
  if (!parsed.success) throw new Error(`${files.case} is not a skim case: ${parsed.error.message}`);
  const labels = parseLabels(labelText, files.labels);
  checkLabels(parsed.data, labels, files.labels);
  return { case: parsed.data, diff, labels };
}

export async function writeCase(files: CaseFiles, loaded: LoadedCase): Promise<void> {
  await mkdir(files.folder, { recursive: true });
  await Promise.all([
    writeFile(files.case, `${JSON.stringify(loaded.case, null, 2)}\n`),
    writeFile(files.diff, loaded.diff),
    writeFile(files.labels, formatLabels(loaded.labels)),
  ]);
}

/** Every case folder under the root, by name. */
export async function listCases(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, CASES_DIR), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/**
 * One JSON object per line, in catalog order, so a person edits a tier by
 * changing one word on one line and a diff of the file reads as a list of
 * changed labels.
 */
export function formatLabels(labels: readonly Label[]): string {
  return labels.map((label) => `${JSON.stringify(label)}\n`).join('');
}

export function parseLabels(text: string, file = 'labels.jsonl'): Label[] {
  const labels: Label[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${String(index + 1)} is not JSON`);
    }
    const parsed = LabelSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`${file}:${String(index + 1)} is not a label: ${parsed.error.message}`);
    }
    labels.push(parsed.data);
  }
  return labels;
}

/**
 * The labels and the catalog must name the same hunks, once each. A hunk
 * without a label would be scored as nothing and a label for a hunk the
 * prompt never shows would be scored against nothing; either silently
 * shrinks the eval.
 */
function checkLabels(skimCase: SkimCase, labels: readonly Label[], file: string): void {
  const catalog = new Set(skimCase.hunks.map((hunk) => hunk.id));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const label of labels) {
    if (!catalog.has(label.id)) problems.push(`${label.id} is not in the case's hunks`);
    if (seen.has(label.id)) problems.push(`${label.id} is labelled twice`);
    seen.add(label.id);
  }
  for (const id of catalog) if (!seen.has(id)) problems.push(`${id} has no label`);
  if (problems.length > 0) throw new Error(`${file}: ${problems.join('; ')}`);
}
