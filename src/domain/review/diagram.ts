import { z } from 'zod';

/**
 * Diagrams a review may attach to a chapter, or to the review as a whole.
 * Shared by server and browser like `narrative.ts`, so nothing here may touch
 * Node or the db. Zod is the source of truth; the types are inferred from it.
 *
 * Four *kinds* are visible to the model, but only two *structures* exist
 * underneath: `architecture`, `state` and `beforeAfter` are all node/edge
 * graphs, and `sequence` is its own thing because it genuinely is one.
 *
 * `beforeAfter` deliberately carries no explicit side field. A node's `change`
 * already says which columns it belongs in — the before column draws what
 * existed before (`unchanged`, `modified`, `removed`) and the after column
 * draws what exists now (`unchanged`, `modified`, `added`), so a modified node
 * appears in both, which is the truth of it: it was there, and it is
 * different. A second field saying the same thing is a second field the model
 * can contradict. The cost is that a node moving between groups cannot be
 * drawn, since a node exists exactly once; that is rare enough to accept.
 *
 * A diagram here describes a *change*, not a system. That is what the `change`
 * marks on every node and edge are for: an unchanged architecture is what a
 * repository's own docs are for, and what a reviewer needs is the part the
 * pull request moved.
 */

/**
 * The bounds. Exported because the prompt builder states them to the model and
 * must not respell them — the same reason the design system exports
 * `CAPTION_TYPE` rather than repeating its values.
 *
 * The node and edge ceilings are sanity bounds, not aesthetics. A large graph
 * is legitimate: the renderer keeps labels at the type scale and lets the
 * diagram scroll or open, rather than shrinking text to fit. What is never
 * legitimate is a label that has become a sentence, so the length caps are the
 * tight ones.
 */
export const DIAGRAM_LIMITS = {
  nodes: 200,
  edges: 400,
  groups: 12,
  participants: 12,
  steps: 60,
  branches: 6,
  hunkIds: 20,
  labelChars: 48,
  edgeLabelChars: 40,
  messageChars: 64,
  captionChars: 240,
  noteChars: 120,
  idChars: 64,
} as const;

const DiagramId = z.string().min(1).max(DIAGRAM_LIMITS.idChars);
const Label = z.string().min(1).max(DIAGRAM_LIMITS.labelChars);

export const DiagramKindSchema = z.enum(['architecture', 'state', 'sequence', 'beforeAfter']);
export type DiagramKind = z.infer<typeof DiagramKindSchema>;

/** What the pull request did to this node or edge. Drives colour and emphasis. */
export const DiagramChangeSchema = z.enum(['added', 'removed', 'modified', 'unchanged']);
export type DiagramChange = z.infer<typeof DiagramChangeSchema>;

/**
 * What a node stands for. Only `code` nodes may be grounded in a file: a
 * database table, an external service and a human actor have no path in the
 * diff, and requiring one would invite the model to invent it.
 */
export const DiagramNodeKindSchema = z.enum(['code', 'data', 'external', 'actor']);
export type DiagramNodeKind = z.infer<typeof DiagramNodeKindSchema>;

/** A labelled container — a layer, a package, a boundary. */
export const DiagramGroupSchema = z.object({
  id: DiagramId,
  label: Label,
});
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>;

export const DiagramNodeSchema = z.object({
  id: DiagramId,
  label: Label,
  kind: DiagramNodeKindSchema.default('code'),
  change: DiagramChangeSchema.default('unchanged'),
  /** Id of a group in the same diagram; cleared at parse time if it is not. */
  group: DiagramId.optional(),
  /** Grounding: a path from the PR's changed-file list. `code` nodes only. */
  filename: z.string().min(1).optional(),
  /** Hunk ids from the prompt catalog, matched against the chapter's chunks. */
  hunkIds: z.array(z.string()).max(DIAGRAM_LIMITS.hunkIds).optional(),
  /** State machines only: the entry state. At most one per diagram. */
  initial: z.boolean().optional(),
  note: z.string().min(1).max(DIAGRAM_LIMITS.noteChars).optional(),
});
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;

/**
 * Edges carry no id, so two edges between the same pair are simply two
 * entries. A state machine needs exactly that: `running` returns to `active`
 * on launch, on deferral and on a failure under the threshold, and those are
 * three different labelled transitions, not one.
 */
export const DiagramEdgeSchema = z.object({
  from: DiagramId,
  to: DiagramId,
  label: z.string().min(1).max(DIAGRAM_LIMITS.edgeLabelChars).optional(),
  change: DiagramChangeSchema.default('unchanged'),
});
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;

export const SequenceParticipantSchema = z.object({
  id: DiagramId,
  label: Label,
  kind: DiagramNodeKindSchema.default('code'),
  change: DiagramChangeSchema.default('unchanged'),
  filename: z.string().min(1).optional(),
  hunkIds: z.array(z.string()).max(DIAGRAM_LIMITS.hunkIds).optional(),
});
export type SequenceParticipant = z.infer<typeof SequenceParticipantSchema>;

export const SequenceMessageSchema = z.object({
  type: z.literal('message'),
  from: DiagramId,
  to: DiagramId,
  label: z.string().min(1).max(DIAGRAM_LIMITS.messageChars),
  /** `return` draws as a dashed arrow back. */
  style: z.enum(['call', 'return']).default('call'),
  change: DiagramChangeSchema.default('unchanged'),
});
export type SequenceMessage = z.infer<typeof SequenceMessageSchema>;

export const SequenceGroupStyleSchema = z.enum(['alt', 'opt', 'loop']);
export type SequenceGroupStyle = z.infer<typeof SequenceGroupStyleSchema>;

/**
 * The innermost group. Nesting stops here on purpose: one pass of a scheduler
 * loop containing a three-way branch needs exactly two levels, and unbounded
 * nesting is where sequence layout stops being tractable.
 */
export const SequenceLeafGroupSchema = z.object({
  type: z.literal('group'),
  style: SequenceGroupStyleSchema,
  label: Label.optional(),
  branches: z
    .array(
      z.object({
        label: Label.optional(),
        steps: z.array(SequenceMessageSchema).min(1).max(DIAGRAM_LIMITS.steps),
      }),
    )
    .min(1)
    .max(DIAGRAM_LIMITS.branches),
});
export type SequenceLeafGroup = z.infer<typeof SequenceLeafGroupSchema>;

export const SequenceGroupSchema = z.object({
  type: z.literal('group'),
  style: SequenceGroupStyleSchema,
  label: Label.optional(),
  branches: z
    .array(
      z.object({
        label: Label.optional(),
        steps: z
          .array(z.discriminatedUnion('type', [SequenceMessageSchema, SequenceLeafGroupSchema]))
          .min(1)
          .max(DIAGRAM_LIMITS.steps),
      }),
    )
    .min(1)
    .max(DIAGRAM_LIMITS.branches),
});
export type SequenceGroup = z.infer<typeof SequenceGroupSchema>;

export const SequenceStepSchema = z.discriminatedUnion('type', [
  SequenceMessageSchema,
  SequenceGroupSchema,
]);
export type SequenceStep = z.infer<typeof SequenceStepSchema>;

/**
 * `caption` is required, and is the lever that keeps diagrams honest: the
 * model has to say what the picture shows that the prose cannot. A diagram
 * that cannot answer that has not earned its place on the page.
 */
const diagramBase = {
  id: DiagramId,
  title: Label,
  caption: z.string().min(1).max(DIAGRAM_LIMITS.captionChars),
};

const graphFields = {
  ...diagramBase,
  direction: z.enum(['down', 'right']).default('down'),
  groups: z.array(DiagramGroupSchema).max(DIAGRAM_LIMITS.groups).optional(),
  nodes: z.array(DiagramNodeSchema).min(2).max(DIAGRAM_LIMITS.nodes),
  edges: z.array(DiagramEdgeSchema).max(DIAGRAM_LIMITS.edges),
};

export const ArchitectureDiagramSchema = z.object({
  ...graphFields,
  kind: z.literal('architecture'),
});
export const StateDiagramSchema = z.object({ ...graphFields, kind: z.literal('state') });
export const BeforeAfterDiagramSchema = z.object({
  ...graphFields,
  kind: z.literal('beforeAfter'),
});

export const SequenceDiagramSchema = z.object({
  ...diagramBase,
  kind: z.literal('sequence'),
  participants: z.array(SequenceParticipantSchema).min(2).max(DIAGRAM_LIMITS.participants),
  steps: z.array(SequenceStepSchema).min(1).max(DIAGRAM_LIMITS.steps),
});

export const DiagramSchema = z.discriminatedUnion('kind', [
  ArchitectureDiagramSchema,
  StateDiagramSchema,
  BeforeAfterDiagramSchema,
  SequenceDiagramSchema,
]);
export type Diagram = z.infer<typeof DiagramSchema>;

export type GraphDiagram =
  | z.infer<typeof ArchitectureDiagramSchema>
  | z.infer<typeof StateDiagramSchema>
  | z.infer<typeof BeforeAfterDiagramSchema>;
export type SequenceDiagram = z.infer<typeof SequenceDiagramSchema>;

/** Narrows to the three kinds that share the node/edge structure. */
export function isGraphDiagram(diagram: Diagram): diagram is GraphDiagram {
  return diagram.kind !== 'sequence';
}

function messageMarks(steps: readonly (SequenceStep | SequenceLeafGroup)[]): DiagramChange[] {
  return steps.flatMap((step) =>
    step.type === 'message'
      ? [step.change]
      : step.branches.flatMap((branch) => messageMarks(branch.steps)),
  );
}

/**
 * The change marks that say something: every box, and every line that carries
 * a change of its own.
 *
 * Lines count because a change can live on a line alone — a rewiring between
 * two unchanged components is drawn entirely in its edges, and reading only
 * the boxes rendered it flat. An `unchanged` line does not count, because it
 * is also the default: a model that marks every node of a new subsystem
 * `added` and leaves its edges bare has not said the edges existed before.
 */
export function changeMarks(diagram: Diagram): DiagramChange[] {
  const boxes = isGraphDiagram(diagram)
    ? diagram.nodes.map((node) => node.change)
    : diagram.participants.map((participant) => participant.change);
  const lines = isGraphDiagram(diagram)
    ? diagram.edges.map((edge) => edge.change)
    : messageMarks(diagram.steps);
  return [...boxes, ...lines.filter((mark) => mark !== 'unchanged')];
}

/**
 * True when everything in the diagram carries the same change class.
 *
 * A wholly new subsystem produces a diagram in which every node is `added`;
 * painting all of it in the change colour is noise, not emphasis, so the
 * renderer drops the treatment entirely in that case. Emphasis only means
 * something when there is something to contrast it against.
 */
export function hasUniformChange(diagram: Diagram): boolean {
  const marks = changeMarks(diagram);
  const first = marks[0];
  if (first === undefined) return true;
  return marks.every((mark) => mark === first);
}
