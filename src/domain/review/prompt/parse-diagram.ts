import { plural } from '../../../common/plural.ts';
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
 * Every one of those drops is written to the `FindingLog`, down to a value
 * that was coerced or a string that was cut rather than discarded: the picture
 * is dropped quietly as far as the reader is concerned, and the review it
 * belongs to carries the receipt.
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

/** A list field as entries still to be checked, or nothing. */
function list(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/** Trimmed, non-empty, and cut to the cap rather than thrown away for length. */
function trimToFit(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/**
 * `trimToFit`, with the cut recorded. A cut caption or label is text the
 * reader is shown as though the model wrote it that way, and a cut id is
 * worse than that: it is how an edge stops finding its node.
 */
function clamp(value: unknown, max: number, what: string, drop: DropPart): string | undefined {
  if (typeof value === 'string' && value.trim().length > max) {
    drop(
      `${plural(value.trim().length - max, 'character')} past the ${String(max)} a ${what} allows`,
    );
  }
  return trimToFit(value, max);
}

/** The list cut to `limit`, with what the cut cost recorded. */
function capped<T>(items: T[], limit: number, what: string, drop: DropPart): T[] {
  if (items.length <= limit) return items;
  drop(`${String(items.length - limit)} ${what} past the limit of ${String(limit)}`);
  return items.slice(0, limit);
}

/**
 * A mark this reader can draw, or `unchanged`. Nothing sent is not something
 * dropped — the mark is optional and its absence says what `unchanged` says —
 * but a mark that arrived unreadable is a claim about the change that the
 * picture then makes differently.
 */
function toChange(raw: unknown, whose: string, drop: DropPart): DiagramChange {
  const parsed = DiagramChangeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (raw !== undefined) drop(`the change mark on ${whose}, which was read as unchanged`);
  return 'unchanged';
}

function toNodeKind(raw: unknown, whose: string, drop: DropPart): DiagramNodeKind {
  const parsed = DiagramNodeKindSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (raw !== undefined) drop(`the kind on ${whose}, which was read as code`);
  return 'code';
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
  const filename = clamp(raw['filename'], 512, 'filename', drop);
  if (filename === undefined) return {};
  if (!grounding?.filenames.has(filename)) {
    drop(`the filename ${filename} on a node, which the change does not contain`);
    return {};
  }

  const resolved = new Set<string>();
  for (const id of list(raw['hunkIds'])) {
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
    list(raw['groups']).flatMap((group) => {
      if (!isRecord(group)) {
        drop('a group that was not an object');
        return [];
      }
      const id = clamp(group['id'], DIAGRAM_LIMITS.idChars, 'group id', drop);
      const label = clamp(group['label'], DIAGRAM_LIMITS.labelChars, 'group label', drop);
      if (id === undefined || label === undefined) {
        drop('a group with no id or no label');
        return [];
      }
      return [{ id, label }];
    }),
    DIAGRAM_LIMITS.groups,
    'groups',
    drop,
  );
  const groupIds = new Set(groups.map((group) => group.id));

  const seen = new Set<string>();
  let initialTaken = false;
  const nodes = capped(
    list(raw['nodes']).flatMap((node) => {
      if (!isRecord(node)) {
        drop('a node that was not an object');
        return [];
      }
      const id = clamp(node['id'], DIAGRAM_LIMITS.idChars, 'node id', drop);
      const label = clamp(node['label'], DIAGRAM_LIMITS.labelChars, 'node label', drop);
      if (id === undefined || label === undefined) {
        drop('a node with no id or no label');
        return [];
      }
      if (seen.has(id)) {
        drop(`a second node claiming the id ${id}`);
        return [];
      }
      seen.add(id);

      const whose = `node ${id}`;
      const nodeKind = toNodeKind(node['kind'], whose, drop);
      const group = clamp(node['group'], DIAGRAM_LIMITS.idChars, 'group name', drop);
      if (group !== undefined && !groupIds.has(group)) {
        drop(`the group ${group} on node ${id}, which the diagram does not declare`);
      }
      // Only a state machine has an entry state, and it has exactly one.
      const initial = kind === 'state' && node['initial'] === true && !initialTaken;
      if (initial) initialTaken = true;
      const note = clamp(node['note'], DIAGRAM_LIMITS.noteChars, 'note', drop);

      return [
        {
          id,
          label,
          kind: nodeKind,
          change: toChange(node['change'], whose, drop),
          ...(group !== undefined && groupIds.has(group) ? { group } : {}),
          ...resolveNodeGrounding(node, nodeKind, grounding, drop),
          ...(initial ? { initial: true } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      ];
    }),
    DIAGRAM_LIMITS.nodes,
    'nodes',
    drop,
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = capped(
    list(raw['edges']).flatMap((edge) => {
      if (!isRecord(edge)) {
        drop('an edge that was not an object');
        return [];
      }
      const from = clamp(edge['from'], DIAGRAM_LIMITS.idChars, 'node id', drop);
      const to = clamp(edge['to'], DIAGRAM_LIMITS.idChars, 'node id', drop);
      if (from === undefined || to === undefined) {
        drop('an edge with no end');
        return [];
      }
      if (!nodeIds.has(from) || !nodeIds.has(to)) {
        drop(`the edge ${from} → ${to}, which names a node the diagram does not have`);
        return [];
      }
      const label = clamp(edge['label'], DIAGRAM_LIMITS.edgeLabelChars, 'edge label', drop);
      return [
        {
          from,
          to,
          ...(label !== undefined ? { label } : {}),
          change: toChange(edge['change'], `the edge ${from} → ${to}`, drop),
        },
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
  // Depth 0 is the top level, 1 is inside a group, 2 is inside a nested group
  // and takes messages only — the schema's two-level cap, enforced here so the
  // parser cannot hand the validator something it will reject.
  const allowGroup = depth < 2;

  return capped(
    list(raw).flatMap((step): Rec[] => {
      if (!isRecord(step)) {
        drop('a step that was not an object');
        return [];
      }
      if (step['type'] === 'group') {
        if (!allowGroup) {
          drop('a group nested deeper than two levels');
          return [];
        }
        const style = SequenceGroupStyleSchema.safeParse(step['style']);
        const branches = capped(
          list(step['branches']).flatMap((branch) => {
            if (!isRecord(branch)) {
              drop('a branch that was not an object');
              return [];
            }
            const steps = sanitizeSteps(branch['steps'], participants, depth + 1, drop);
            if (steps.length === 0) {
              drop('a branch with no steps left in it');
              return [];
            }
            const label = clamp(branch['label'], DIAGRAM_LIMITS.labelChars, 'branch label', drop);
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

        const label = clamp(step['label'], DIAGRAM_LIMITS.labelChars, 'group label', drop);
        return [
          {
            type: 'group',
            style: style.success ? style.data : 'alt',
            ...(label !== undefined ? { label } : {}),
            branches,
          },
        ];
      }

      const from = clamp(step['from'], DIAGRAM_LIMITS.idChars, 'participant id', drop);
      const to = clamp(step['to'], DIAGRAM_LIMITS.idChars, 'participant id', drop);
      const label = clamp(step['label'], DIAGRAM_LIMITS.messageChars, 'message label', drop);
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
          change: toChange(step['change'], `the message ${from} → ${to}`, drop),
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
    list(raw['participants']).flatMap((participant) => {
      if (!isRecord(participant)) {
        drop('a participant that was not an object');
        return [];
      }
      const id = clamp(participant['id'], DIAGRAM_LIMITS.idChars, 'participant id', drop);
      const label = clamp(
        participant['label'],
        DIAGRAM_LIMITS.labelChars,
        'participant label',
        drop,
      );
      if (id === undefined || label === undefined) {
        drop('a participant with no id or no label');
        return [];
      }
      if (seen.has(id)) {
        drop(`a second participant claiming the id ${id}`);
        return [];
      }
      seen.add(id);
      const whose = `participant ${id}`;
      const kind = toNodeKind(participant['kind'], whose, drop);
      return [
        {
          id,
          label,
          kind,
          change: toChange(participant['change'], whose, drop),
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

  // The one string cut with nothing said about it: the diagram's own id is
  // never shown and nothing points at it, and every finding below is addressed
  // to it, so it has to be settled before there is a `drop` to record with.
  const id = trimToFit(raw['id'], DIAGRAM_LIMITS.idChars) ?? fallbackId;
  const drop: DropPart = (what) =>
    log.add('diagram-part-dropped', `Diagram ${id} dropped ${what}.`);
  const dropWhole = (why: string): undefined => {
    log.add('diagram-dropped', `Diagram ${id} was dropped: ${why}.`);
    return undefined;
  };

  const kind = DiagramKindSchema.safeParse(raw['kind']);
  if (!kind.success) return dropWhole('it names no kind this reader can draw');

  const caption = clamp(raw['caption'], DIAGRAM_LIMITS.captionChars, 'caption', drop);
  if (caption === undefined) return dropWhole('it has no caption');

  const candidate: Rec = {
    id,
    title:
      clamp(raw['title'], DIAGRAM_LIMITS.labelChars, 'title', drop) ??
      FALLBACK_TITLES[kind.data] ??
      'Diagram',
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
