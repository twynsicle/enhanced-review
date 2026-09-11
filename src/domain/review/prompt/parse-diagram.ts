import {
  DiagramChangeSchema,
  DiagramKindSchema,
  DiagramNodeKindSchema,
  DiagramSchema,
  DIAGRAM_LIMITS,
  SequenceGroupStyleSchema,
  type Diagram,
  type DiagramChange,
  type DiagramNodeKind,
} from '../diagram.ts';
import type { DiffHunkIndex } from './diff-hunk-catalog.ts';

/**
 * Turns whatever the model put in a `diagram` field into a `Diagram`, or into
 * nothing at all.
 *
 * Lenient in the same direction as `parse-narrative.ts`: the invalid *part* is
 * dropped, never the review. An edge pointing at a node that does not exist
 * goes; a `group` that names no group is cleared; a `filename` the diff does
 * not contain is cleared, which costs the node its click-through and nothing
 * else. What is dropped whole is a diagram that has emptied out — fewer than
 * two nodes, or no steps left — and one with no caption, because the caption is
 * the model's answer to "what does this show that the prose cannot", and a
 * diagram that cannot answer that has not earned its place on the page.
 *
 * The result is validated against `DiagramSchema` here rather than left to the
 * whole-review validation at the end. That is deliberate: a malformed diagram
 * must not be able to take a good review down with it.
 */
type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null;
}

/** Trimmed, non-empty, and cut to the cap rather than thrown away for length. */
function clamp(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

function toChange(raw: unknown): DiagramChange {
  const parsed = DiagramChangeSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'unchanged';
}

function toNodeKind(raw: unknown): DiagramNodeKind {
  const parsed = DiagramNodeKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'code';
}

/**
 * The filenames the diff actually contained. Grounding is checked against the
 * hunk catalog for the same reason `diffChunks` is: it is the only list in the
 * prompt the model could not have invented. A file truncated out of the diff
 * is unknown here, so its node keeps its label and loses its link — the
 * conservative direction.
 */
function knownFilenames(hunkIndex: DiffHunkIndex | undefined): Set<string> {
  return new Set(hunkIndex?.hunks.map((hunk) => hunk.filename) ?? []);
}

interface Grounding {
  filename?: string;
  hunkIds?: string[];
}

function resolveGrounding(
  raw: Rec,
  kind: DiagramNodeKind,
  files: Set<string>,
  hunkIndex: DiffHunkIndex | undefined,
): Grounding {
  // Only code has a path. A table, a service or a person does not, and asking
  // for one is asking the model to make one up.
  if (kind !== 'code') return {};
  const filename = clamp(raw['filename'], 512);
  if (filename === undefined || !files.has(filename)) return {};

  const rawIds = Array.isArray(raw['hunkIds']) ? raw['hunkIds'] : [];
  const hunkIds = [
    ...new Set(
      rawIds.filter((id): id is string => {
        if (typeof id !== 'string') return false;
        const hunk = hunkIndex?.byId[id];
        return hunk !== undefined && hunk.filename === filename;
      }),
    ),
  ].slice(0, DIAGRAM_LIMITS.hunkIds);

  return hunkIds.length > 0 ? { filename, hunkIds } : { filename };
}

function sanitizeGraph(raw: Rec, kind: string, files: Set<string>, hunkIndex?: DiffHunkIndex): Rec {
  const groups = (Array.isArray(raw['groups']) ? raw['groups'] : [])
    .filter(isRecord)
    .map((group) => ({
      id: clamp(group['id'], DIAGRAM_LIMITS.idChars),
      label: clamp(group['label'], DIAGRAM_LIMITS.labelChars),
    }))
    .filter((group): group is { id: string; label: string } => !!group.id && !!group.label)
    .slice(0, DIAGRAM_LIMITS.groups);
  const groupIds = new Set(groups.map((group) => group.id));

  const seen = new Set<string>();
  let initialTaken = false;
  const nodes = (Array.isArray(raw['nodes']) ? raw['nodes'] : [])
    .filter(isRecord)
    .flatMap((node) => {
      const id = clamp(node['id'], DIAGRAM_LIMITS.idChars);
      const label = clamp(node['label'], DIAGRAM_LIMITS.labelChars);
      if (id === undefined || label === undefined || seen.has(id)) return [];
      seen.add(id);

      const nodeKind = toNodeKind(node['kind']);
      const group = clamp(node['group'], DIAGRAM_LIMITS.idChars);
      // Only a state machine has an entry state, and it has exactly one.
      const initial = kind === 'state' && node['initial'] === true && !initialTaken;
      if (initial) initialTaken = true;

      return [
        {
          id,
          label,
          kind: nodeKind,
          change: toChange(node['change']),
          ...(group !== undefined && groupIds.has(group) ? { group } : {}),
          ...resolveGrounding(node, nodeKind, files, hunkIndex),
          ...(initial ? { initial: true } : {}),
          ...(clamp(node['note'], DIAGRAM_LIMITS.noteChars) !== undefined
            ? { note: clamp(node['note'], DIAGRAM_LIMITS.noteChars) }
            : {}),
        },
      ];
    })
    .slice(0, DIAGRAM_LIMITS.nodes);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(raw['edges']) ? raw['edges'] : [])
    .filter(isRecord)
    .flatMap((edge) => {
      const from = clamp(edge['from'], DIAGRAM_LIMITS.idChars);
      const to = clamp(edge['to'], DIAGRAM_LIMITS.idChars);
      if (from === undefined || to === undefined) return [];
      if (!nodeIds.has(from) || !nodeIds.has(to)) return [];
      const label = clamp(edge['label'], DIAGRAM_LIMITS.edgeLabelChars);
      return [
        { from, to, ...(label !== undefined ? { label } : {}), change: toChange(edge['change']) },
      ];
    })
    .slice(0, DIAGRAM_LIMITS.edges);

  const direction = raw['direction'] === 'right' ? 'right' : 'down';
  return { direction, ...(groups.length > 0 ? { groups } : {}), nodes, edges };
}

function sanitizeSteps(raw: unknown, participants: Set<string>, depth: number): Rec[] {
  if (!Array.isArray(raw)) return [];
  // Depth 0 is the top level, 1 is inside a group, 2 is inside a nested group
  // and takes messages only — the schema's two-level cap, enforced here so the
  // parser cannot hand the validator something it will reject.
  const allowGroup = depth < 2;

  return raw
    .filter(isRecord)
    .flatMap((step): Rec[] => {
      if (step['type'] === 'group') {
        if (!allowGroup) return [];
        const style = SequenceGroupStyleSchema.safeParse(step['style']);
        const branches = (Array.isArray(step['branches']) ? step['branches'] : [])
          .filter(isRecord)
          .flatMap((branch) => {
            const steps = sanitizeSteps(branch['steps'], participants, depth + 1);
            if (steps.length === 0) return [];
            const label = clamp(branch['label'], DIAGRAM_LIMITS.labelChars);
            return [{ ...(label !== undefined ? { label } : {}), steps }];
          })
          .slice(0, DIAGRAM_LIMITS.branches);
        if (branches.length === 0) return [];

        const label = clamp(step['label'], DIAGRAM_LIMITS.labelChars);
        return [
          {
            type: 'group',
            style: style.success ? style.data : 'alt',
            ...(label !== undefined ? { label } : {}),
            branches,
          },
        ];
      }

      const from = clamp(step['from'], DIAGRAM_LIMITS.idChars);
      const to = clamp(step['to'], DIAGRAM_LIMITS.idChars);
      const label = clamp(step['label'], DIAGRAM_LIMITS.messageChars);
      if (from === undefined || to === undefined || label === undefined) return [];
      if (!participants.has(from) || !participants.has(to)) return [];
      return [
        {
          type: 'message',
          from,
          to,
          label,
          style: step['style'] === 'return' ? 'return' : 'call',
          change: toChange(step['change']),
        },
      ];
    })
    .slice(0, DIAGRAM_LIMITS.steps);
}

function sanitizeSequence(raw: Rec, files: Set<string>, hunkIndex?: DiffHunkIndex): Rec {
  const seen = new Set<string>();
  const participants = (Array.isArray(raw['participants']) ? raw['participants'] : [])
    .filter(isRecord)
    .flatMap((participant) => {
      const id = clamp(participant['id'], DIAGRAM_LIMITS.idChars);
      const label = clamp(participant['label'], DIAGRAM_LIMITS.labelChars);
      if (id === undefined || label === undefined || seen.has(id)) return [];
      seen.add(id);
      const kind = toNodeKind(participant['kind']);
      return [
        {
          id,
          label,
          kind,
          change: toChange(participant['change']),
          ...resolveGrounding(participant, kind, files, hunkIndex),
        },
      ];
    })
    .slice(0, DIAGRAM_LIMITS.participants);

  return {
    participants,
    steps: sanitizeSteps(raw['steps'], new Set(participants.map((p) => p.id)), 0),
  };
}

/** Per-kind fallback title. A missing title is cosmetic; a missing caption is not. */
const FALLBACK_TITLES: Record<string, string> = {
  architecture: 'Architecture',
  state: 'States',
  sequence: 'Sequence',
  beforeAfter: 'Before and after',
};

export function sanitizeDiagram(
  raw: unknown,
  fallbackId: string,
  hunkIndex?: DiffHunkIndex,
): Diagram | undefined {
  if (!isRecord(raw)) return undefined;
  const kind = DiagramKindSchema.safeParse(raw['kind']);
  if (!kind.success) return undefined;

  const caption = clamp(raw['caption'], DIAGRAM_LIMITS.captionChars);
  if (caption === undefined) return undefined;

  const files = knownFilenames(hunkIndex);
  const candidate: Rec = {
    id: clamp(raw['id'], DIAGRAM_LIMITS.idChars) ?? fallbackId,
    title:
      clamp(raw['title'], DIAGRAM_LIMITS.labelChars) ?? FALLBACK_TITLES[kind.data] ?? 'Diagram',
    caption,
    kind: kind.data,
    ...(kind.data === 'sequence'
      ? sanitizeSequence(raw, files, hunkIndex)
      : sanitizeGraph(raw, kind.data, files, hunkIndex)),
  };

  const validated = DiagramSchema.safeParse(candidate);
  return validated.success ? validated.data : undefined;
}
