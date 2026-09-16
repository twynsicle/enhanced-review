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
import type { FindingLog } from '../findings.ts';
import type { PromptGrounding } from './diff-hunk-catalog.ts';

/**
 * Turns whatever the model put in a `diagram` field into a `Diagram`, or into
 * nothing at all.
 *
 * Lenient in the same direction as `parse-narrative.ts`: the invalid *part* is
 * dropped, never the review. An edge pointing at a node that does not exist
 * goes; a `group` that names no group is cleared; a `filename` the change does
 * not contain is cleared, which costs the node its click-through and nothing
 * else. What is dropped whole is a diagram that has emptied out — fewer than
 * two nodes, or no steps left — and one with no caption, because the caption is
 * the model's answer to "what does this show that the prose cannot", and a
 * diagram that cannot answer that has not earned its place on the page.
 *
 * Every one of those drops is written to the `FindingLog`: the picture is
 * still dropped quietly as far as the reader is concerned, but the review it
 * belongs to now carries the receipt.
 *
 * The result is validated against `DiagramSchema` here rather than left to the
 * whole-review validation at the end. That is deliberate: a malformed diagram
 * must not be able to take a good review down with it.
 */
type Rec = Record<string, unknown>;

/** Records one dropped part of the diagram it is bound to. */
type DropPart = (what: string) => void;

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

/** The list cut to `limit`, with what the cut cost recorded. */
function capped<T>(items: T[], limit: number, what: string, drop: DropPart): T[] {
  if (items.length <= limit) return items;
  drop(`${String(items.length - limit)} ${what} past the limit of ${String(limit)}`);
  return items.slice(0, limit);
}

function toChange(raw: unknown): DiagramChange {
  const parsed = DiagramChangeSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'unchanged';
}

function toNodeKind(raw: unknown): DiagramNodeKind {
  const parsed = DiagramNodeKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'code';
}

interface NodeGrounding {
  filename?: string;
  hunkIds?: string[];
}

/**
 * A node's link into the change. The filename is checked against the file
 * list, and the hunk ids against the hunks the prompt showed: both are lists
 * the model could not have invented, and they are not the same list — a file
 * the prompt showed no hunks for is still a file, and its node keeps the page
 * it links to while losing the hunks it cannot name.
 */
function resolveNodeGrounding(
  raw: Rec,
  kind: DiagramNodeKind,
  grounding: PromptGrounding | undefined,
  drop: DropPart,
): NodeGrounding {
  // Only code has a path. A table, a service or a person does not, and asking
  // for one is asking the model to make one up.
  if (kind !== 'code') return {};
  const filename = clamp(raw['filename'], 512);
  if (filename === undefined) return {};
  if (!grounding?.filenames.has(filename)) {
    drop(`the filename ${filename} on a node, which the change does not contain`);
    return {};
  }

  const rawIds: unknown[] = Array.isArray(raw['hunkIds']) ? raw['hunkIds'] : [];
  const resolved = new Set<string>();
  for (const id of rawIds) {
    if (typeof id === 'string' && grounding.shown.byId[id]?.filename === filename) {
      resolved.add(id);
      continue;
    }
    drop(`a hunk id on the node for ${filename} that resolved against nothing`);
  }
  const hunkIds = capped([...resolved], DIAGRAM_LIMITS.hunkIds, 'hunk ids', drop);

  return hunkIds.length > 0 ? { filename, hunkIds } : { filename };
}

function sanitizeGraph(
  raw: Rec,
  kind: string,
  grounding: PromptGrounding | undefined,
  drop: DropPart,
): Rec {
  const groups = capped(
    (Array.isArray(raw['groups']) ? raw['groups'] : [])
      .filter(isRecord)
      .map((group) => ({
        id: clamp(group['id'], DIAGRAM_LIMITS.idChars),
        label: clamp(group['label'], DIAGRAM_LIMITS.labelChars),
      }))
      .filter((group): group is { id: string; label: string } => {
        if (group.id && group.label) return true;
        drop('a group with no id or no label');
        return false;
      }),
    DIAGRAM_LIMITS.groups,
    'groups',
    drop,
  );
  const groupIds = new Set(groups.map((group) => group.id));

  const seen = new Set<string>();
  let initialTaken = false;
  const nodes = capped(
    (Array.isArray(raw['nodes']) ? raw['nodes'] : []).filter(isRecord).flatMap((node) => {
      const id = clamp(node['id'], DIAGRAM_LIMITS.idChars);
      const label = clamp(node['label'], DIAGRAM_LIMITS.labelChars);
      if (id === undefined || label === undefined) {
        drop('a node with no id or no label');
        return [];
      }
      if (seen.has(id)) {
        drop(`a second node claiming the id ${id}`);
        return [];
      }
      seen.add(id);

      const nodeKind = toNodeKind(node['kind']);
      const group = clamp(node['group'], DIAGRAM_LIMITS.idChars);
      if (group !== undefined && !groupIds.has(group)) {
        drop(`the group ${group} on node ${id}, which the diagram does not declare`);
      }
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
          ...resolveNodeGrounding(node, nodeKind, grounding, drop),
          ...(initial ? { initial: true } : {}),
          ...(clamp(node['note'], DIAGRAM_LIMITS.noteChars) !== undefined
            ? { note: clamp(node['note'], DIAGRAM_LIMITS.noteChars) }
            : {}),
        },
      ];
    }),
    DIAGRAM_LIMITS.nodes,
    'nodes',
    drop,
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = capped(
    (Array.isArray(raw['edges']) ? raw['edges'] : []).filter(isRecord).flatMap((edge) => {
      const from = clamp(edge['from'], DIAGRAM_LIMITS.idChars);
      const to = clamp(edge['to'], DIAGRAM_LIMITS.idChars);
      if (from === undefined || to === undefined) {
        drop('an edge with no end');
        return [];
      }
      if (!nodeIds.has(from) || !nodeIds.has(to)) {
        drop(`the edge ${from} → ${to}, which names a node the diagram does not have`);
        return [];
      }
      const label = clamp(edge['label'], DIAGRAM_LIMITS.edgeLabelChars);
      return [
        { from, to, ...(label !== undefined ? { label } : {}), change: toChange(edge['change']) },
      ];
    }),
    DIAGRAM_LIMITS.edges,
    'edges',
    drop,
  );

  const direction = raw['direction'] === 'right' ? 'right' : 'down';
  return { direction, ...(groups.length > 0 ? { groups } : {}), nodes, edges };
}

function sanitizeSteps(
  raw: unknown,
  participants: Set<string>,
  depth: number,
  drop: DropPart,
): Rec[] {
  if (!Array.isArray(raw)) return [];
  // Depth 0 is the top level, 1 is inside a group, 2 is inside a nested group
  // and takes messages only — the schema's two-level cap, enforced here so the
  // parser cannot hand the validator something it will reject.
  const allowGroup = depth < 2;

  return capped(
    raw.filter(isRecord).flatMap((step): Rec[] => {
      if (step['type'] === 'group') {
        if (!allowGroup) {
          drop('a group nested deeper than two levels');
          return [];
        }
        const style = SequenceGroupStyleSchema.safeParse(step['style']);
        const branches = capped(
          (Array.isArray(step['branches']) ? step['branches'] : [])
            .filter(isRecord)
            .flatMap((branch) => {
              const steps = sanitizeSteps(branch['steps'], participants, depth + 1, drop);
              if (steps.length === 0) {
                drop('a branch with no steps left in it');
                return [];
              }
              const label = clamp(branch['label'], DIAGRAM_LIMITS.labelChars);
              return [{ ...(label !== undefined ? { label } : {}), steps }];
            }),
          DIAGRAM_LIMITS.branches,
          'branches',
          drop,
        );
        if (branches.length === 0) {
          drop('a group with no branches left in it');
          return [];
        }

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
      if (from === undefined || to === undefined || label === undefined) {
        drop('a message with no sender, no recipient or no label');
        return [];
      }
      if (!participants.has(from) || !participants.has(to)) {
        drop(`the message ${from} → ${to}, which names a participant the diagram does not have`);
        return [];
      }
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
    }),
    DIAGRAM_LIMITS.steps,
    'steps',
    drop,
  );
}

function sanitizeSequence(raw: Rec, grounding: PromptGrounding | undefined, drop: DropPart): Rec {
  const seen = new Set<string>();
  const participants = capped(
    (Array.isArray(raw['participants']) ? raw['participants'] : [])
      .filter(isRecord)
      .flatMap((participant) => {
        const id = clamp(participant['id'], DIAGRAM_LIMITS.idChars);
        const label = clamp(participant['label'], DIAGRAM_LIMITS.labelChars);
        if (id === undefined || label === undefined) {
          drop('a participant with no id or no label');
          return [];
        }
        if (seen.has(id)) {
          drop(`a second participant claiming the id ${id}`);
          return [];
        }
        seen.add(id);
        const kind = toNodeKind(participant['kind']);
        return [
          {
            id,
            label,
            kind,
            change: toChange(participant['change']),
            ...resolveNodeGrounding(participant, kind, grounding, drop),
          },
        ];
      }),
    DIAGRAM_LIMITS.participants,
    'participants',
    drop,
  );

  return {
    participants,
    steps: sanitizeSteps(raw['steps'], new Set(participants.map((p) => p.id)), 0, drop),
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
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): Diagram | undefined {
  // Nothing in the field is not a dropped diagram; there was never one.
  if (!isRecord(raw)) return undefined;

  const id = clamp(raw['id'], DIAGRAM_LIMITS.idChars) ?? fallbackId;
  const drop: DropPart = (what) =>
    log.add('diagram-part-dropped', `Diagram ${id} dropped ${what}.`);
  const dropWhole = (why: string): undefined => {
    log.add('diagram-dropped', `Diagram ${id} was dropped: ${why}.`);
    return undefined;
  };

  const kind = DiagramKindSchema.safeParse(raw['kind']);
  if (!kind.success) return dropWhole('it names no kind this reader can draw');

  const caption = clamp(raw['caption'], DIAGRAM_LIMITS.captionChars);
  if (caption === undefined) return dropWhole('it has no caption');

  const candidate: Rec = {
    id,
    title:
      clamp(raw['title'], DIAGRAM_LIMITS.labelChars) ?? FALLBACK_TITLES[kind.data] ?? 'Diagram',
    caption,
    kind: kind.data,
    ...(kind.data === 'sequence'
      ? sanitizeSequence(raw, grounding, drop)
      : sanitizeGraph(raw, kind.data, grounding, drop)),
  };

  const validated = DiagramSchema.safeParse(candidate);
  if (!validated.success) return dropWhole('what was left of it is not a diagram');
  return validated.data;
}
