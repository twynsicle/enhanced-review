import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DiagramKindSchema } from '../review/diagram.ts';
import { BranchSpecSchema, listBranches, parseBranchSpec, type ModelRepo } from './contrive.ts';

/**
 * A diagram case is a branch over the order service, written from the
 * diagram it should produce and then dressed as an ordinary change: a
 * description as the engineer would write it, tests, and the small edits
 * that ride along with real work, so that the picture has to be chosen out
 * of the change rather than handed over by its shape.
 *
 *   evals/diagrams/contrived/
 *     base/                 packhouse, the tree every branch starts from
 *     <name>/branch.json    the skim eval's spec, plus `expect`
 *     <name>/files/         the files the branch changes or adds, whole
 *
 * Unlike a skim case, nothing is cut from the branch and kept: the model
 * needs the repository, not a diff, so a sweep stands the branch up again
 * each time. The branch is the case.
 */
export const DIAGRAM_CONTRIVED_DIR = 'evals/diagrams/contrived';
export const DIAGRAM_RESULTS_DIR = 'evals/diagrams/results';

/**
 * What the change deserves. The model never sees it.
 *
 * `overview` is null when the change deserves none, else the kinds it may
 * be; `chapterDiagrams` bounds how many chapters may carry one and of which
 * kinds, with `max: 0` the control. `mustName` is prose, for the eye on the
 * contact sheet and for a judge later; `mustReach` is the untouched files a
 * mechanism map should ground once a node may reach outside the diff, or a
 * folder, written with a trailing "/", that a part spanning it should be
 * grounded in whole;
 * `question` is what a reader should be able to answer from the overview
 * alone.
 */
export const ExpectSchema = z
  .object({
    overview: z.object({ kinds: z.array(DiagramKindSchema).min(1) }).nullable(),
    chapterDiagrams: z.object({
      min: z.number().int().min(0),
      max: z.number().int().min(0),
      kinds: z.array(DiagramKindSchema),
    }),
    mustName: z.array(z.string().min(1)),
    mustReach: z.array(z.string().min(1)),
    question: z.string().min(1),
  })
  .refine((expect) => expect.chapterDiagrams.max >= expect.chapterDiagrams.min, {
    message: 'chapterDiagrams.max is below its min',
  })
  .refine((expect) => expect.chapterDiagrams.max === 0 || expect.chapterDiagrams.kinds.length > 0, {
    message: 'chapterDiagrams allows a diagram but names no kind for it',
  });
export type Expect = z.infer<typeof ExpectSchema>;

export const DiagramBranchSpecSchema = BranchSpecSchema.extend({ expect: ExpectSchema });
export type DiagramBranchSpec = z.infer<typeof DiagramBranchSpecSchema>;

export function packhouseRepo(root: string): ModelRepo {
  return {
    base: path.join(root, DIAGRAM_CONTRIVED_DIR, 'base'),
    name: 'packhouse',
    importSubject: 'Import the order service',
    author: {
      name: 'Tomas Reinholt',
      email: 'tomas@packhouse.example',
      date: '2025-02-11T14:20:00Z',
    },
  };
}

export function readDiagramSpec(specDir: string): Promise<DiagramBranchSpec> {
  return parseBranchSpec(path.join(specDir, 'branch.json'), DiagramBranchSpecSchema);
}

/** Every diagram branch under the root, by name. */
export function listDiagramBranches(root: string): Promise<string[]> {
  return listBranches(path.join(root, DIAGRAM_CONTRIVED_DIR));
}

/**
 * Words that would tell the model what a branch is for. Checked over the
 * spec's prose and every file the branch lays down, since the model reads
 * both; `diagram` is on the list because a change that names its own picture
 * has not made the model choose it.
 */
export const GIVEAWAY = /fixture|contrived|eval|sample|synthetic|diagram/i;

/** Where a branch gives itself away: `branch.json` fields and files, by name, with the word found. */
export async function giveaways(specDir: string, spec: DiagramBranchSpec): Promise<string[]> {
  const found: string[] = [];
  const prose: [string, string][] = [
    ['title', spec.title],
    ['description', spec.description],
    ['commit.subject', spec.commit.subject],
    ['commit.body', spec.commit.body],
  ];
  for (const [field, text] of prose) {
    const match = GIVEAWAY.exec(text);
    if (match) found.push(`branch.json ${field}: "${match[0]}"`);
  }
  for (const file of await filesUnder(path.join(specDir, 'files'))) {
    const match = GIVEAWAY.exec(await readFile(file, 'utf8'));
    if (match) found.push(`${path.relative(specDir, file)}: "${match[0]}"`);
  }
  return found;
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted();
}

/**
 * A fingerprint of the change a branch makes: the base, its files and its
 * spec, `expect` left out. A sweep records it so that a later score or
 * contact sheet is refused when the change has moved under it, while an
 * edited expectation rescores the answers already paid for.
 */
export async function branchDigest(root: string, name: string): Promise<string> {
  const contrived = path.join(root, DIAGRAM_CONTRIVED_DIR);
  const specDir = path.join(contrived, name);
  const hash = createHash('sha256');
  for (const [label, dir] of [
    ['base', path.join(contrived, 'base')],
    ['files', path.join(specDir, 'files')],
  ] as const) {
    for (const file of await filesUnder(dir)) {
      hash.update(`${label}/${path.relative(dir, file).replaceAll(path.sep, '/')}\0`);
      hash.update(await readFile(file));
      hash.update('\0');
    }
  }
  const spec = await readDiagramSpec(specDir);
  hash.update(JSON.stringify({ ...spec, expect: null }));
  return hash.digest('hex').slice(0, 16);
}
