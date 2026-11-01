import { z } from 'zod';

/**
 * How a run's diagrams are drawn, chosen with `--diagram-style`: one style
 * per run, never chosen by the model and never mixed in one review. Whether
 * a diagram is drawn at all, and of which kind, is the system prompt's and
 * the same in both; a style decides what a node is, what it is called and
 * how far a picture reaches past the change.
 *
 * - `mechanism`, the default: the running system the change moves through,
 *   each part named by what it does, the untouched parts around the change
 *   drawn and grounded in their own files, so a reader who does not know the
 *   code can see where the change sits.
 * - `files`: the code the change touched and what it calls, named as the
 *   code names it, grounded only in the change's own files. Some readers
 *   find the relationships between files the most useful picture.
 *
 * Like an overview style, a diagram style is a section of the run's own
 * prompt, so the system prompt stays byte-identical across runs and is read
 * from cache.
 */
export const DIAGRAM_STYLES = ['mechanism', 'files'] as const;
export const DiagramStyleSchema = z.enum(DIAGRAM_STYLES);
export type DiagramStyle = z.infer<typeof DiagramStyleSchema>;

export const DEFAULT_DIAGRAM_STYLE: DiagramStyle = 'mechanism';

export function isDiagramStyle(name: string): name is DiagramStyle {
  return (DIAGRAM_STYLES as readonly string[]).includes(name);
}

export const DIAGRAM_STYLE_TEXT: Record<DiagramStyle, string> = {
  mechanism: [
    'Draw every diagram in the mechanism style. The picture is the running system this change moves through, drawn so that a reader who has never opened this repository can see where the change sits and what it touches.',
    '',
    '- The style decides how a diagram is drawn, never whether one is drawn or which kind it is: choose that by the Diagrams section alone. When the Diagrams section calls for a "beforeAfter", both its panels are drawn in this style.',
    '- Name every node by its responsibility, in plain words: "Card gateway", "Retry sweep", "Packing worker", "Orders table". Never label a node with an identifier, a file name or a path; the file or folder that implements it goes in its "filename". Name an edge by what passes along it or what happens: "capture fails", "enqueue retry", "poll due jobs".',
    '- Show the change inside the system around it. Beside the parts the change adds, alters or removes, draw the existing parts it attaches to, reads from, writes to, hands work to or is called by, though the diff never touches them, and mark them "unchanged": the few that are not are what the reviewer must look at, and the rest is where they sit. Draw only the parts the change actually meets; a part it never reaches stays out, however near it sits.',
    '- Find those parts by reading, not by guessing: follow the changed code to its callers, to the code it calls, and to the queue, table, event or schedule it shares with other code. Draw only what the diff, the description and the files you read support.',
    '- Ground every node that lives in code. A node the change touched carries a "filename" from the Files Changed list and may carry "hunkIds" from the Changed Hunks list for that same file. An "unchanged" node carries the path of what implements it, from anywhere in the repository, written from the repository root, with no "hunkIds": the file, or, when the part spans several files, the folder that holds them, ending in "/" ("src/worker/"). A part is one node however many files it spans; never split it into a node per file to give each a path. Name a path outside the change only once you have read it in this run, and never invent one. A "data" node may carry the file that defines it; an "external" or "actor" node carries none.',
    '- A chapter’s diagram may stay inside the change when its subject is one flow, lifecycle or ordering. It still names its nodes by what they do.',
  ].join('\n'),
  files: [
    'Draw every diagram in the files style. The picture is the code this change touched and the code it calls, named as the code names it.',
    '',
    '- Label a node with a name, not a sentence: the module, function or type it is.',
    '- Ground what you can. A "code" or "data" node may carry a "filename" from the Files Changed list and "hunkIds" from the Changed Hunks list for that same file. An "external" or "actor" node — a service, a person — must not carry a filename. Never invent a path or an id.',
    '- Draw only what the diff and the PR description support. Where the description explains a flow, a lifecycle, a rollout or a decision, that is the best material for a diagram — but do not invent structure you cannot see in either.',
  ].join('\n'),
};

/** The prompt.md section naming the run's diagram style. */
export function diagramStyleSection(style: DiagramStyle): string {
  return `## Diagram Style\n${DIAGRAM_STYLE_TEXT[style]}`;
}
