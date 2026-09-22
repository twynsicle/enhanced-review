import {
  hasUniformChange,
  type DiagramChange,
  type DiagramNodeKind,
  type SequenceDiagram,
  type SequenceStep,
} from '@/review/diagram';
import { cutFrom, DIAGRAM_TYPE, estimateTextWidth, widestLine, wrapLabel } from './text-metrics';

/**
 * Sequence layout, done by hand rather than by an engine.
 *
 * Participants are columns and steps are rows, so the maths is arithmetic and
 * deterministic — no ranking, no crossing minimisation, nothing dagre would
 * help with. Groups are boxes drawn around a span of rows, with a dashed rule
 * between branches: an `alt` is the one shape here that carries real reviewing
 * value, because three outcomes stacked in one frame is what lets a reviewer
 * read them against each other.
 *
 * Nesting is two levels by schema, so the walk is bounded and needs no cycle
 * guard.
 */
const HEAD_MIN_W = 104;
const HEAD_MAX_W = 190;
const HEAD_PAD_X = 12;
const HEAD_PAD_Y = 9;
const HEAD_MAX_LINES = 2;
const COL_GAP = 44;
const ROW_H = 46;
const GROUP_HEADER_H = 22;
const GROUP_PAD_X = 14;
const GROUP_PAD_Y = 10;
const BRANCH_LABEL_H = 18;
const MARGIN = 14;
const LIFELINE_TOP_GAP = 10;
const LIFELINE_TAIL = 22;
/** Where a self-call's label starts, right of its lifeline: clear of the loop. */
export const SELF_LABEL_OFFSET = 38;
/** A self-call's label sits beside the loop, not over a span, so it wraps to this. */
const SELF_LABEL_W = 160;

export interface LaidOutParticipant {
  id: string;
  lines: string[];
  /** The whole label when `lines` is a cut-down version of it; see `cutFrom`. */
  fullLabel?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  change: DiagramChange;
  kind: DiagramNodeKind;
  filename?: string;
  hunkIds?: string[];
}

export interface LaidOutMessage {
  key: string;
  fromX: number;
  toX: number;
  y: number;
  lines: string[];
  /** The whole label when `lines` is a cut-down version of it; see `cutFrom`. */
  fullLabel?: string;
  style: 'call' | 'return';
  change: DiagramChange;
  selfCall: boolean;
}

export interface LaidOutBranch {
  /** Top of the branch's own band, where its dashed rule and label sit. */
  y: number;
  label?: string;
  /** False for the first branch, which needs no separating rule. */
  rule: boolean;
}

export interface LaidOutGroupBox {
  key: string;
  style: 'alt' | 'opt' | 'loop';
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  branches: LaidOutBranch[];
}

export interface SequenceLayout {
  width: number;
  height: number;
  uniform: boolean;
  participants: LaidOutParticipant[];
  messages: LaidOutMessage[];
  groups: LaidOutGroupBox[];
  lifelineTop: number;
  lifelineBottom: number;
}

function measureHead(label: string): {
  lines: string[];
  fullLabel?: string;
  width: number;
  height: number;
} {
  const { size, lineHeight } = DIAGRAM_TYPE.node;
  const inner = HEAD_MAX_W - HEAD_PAD_X * 2;
  const lines =
    estimateTextWidth(label, size) <= inner
      ? [label]
      : wrapLabel(label, inner, size, HEAD_MAX_LINES);
  const width = Math.min(
    HEAD_MAX_W,
    Math.max(HEAD_MIN_W, Math.ceil(widestLine(lines, size)) + HEAD_PAD_X * 2),
  );
  const fullLabel = cutFrom(label, lines);
  return {
    lines,
    ...(fullLabel !== undefined ? { fullLabel } : {}),
    width,
    height: lines.length * lineHeight + HEAD_PAD_Y * 2,
  };
}

/** Rows and group frames, walked in document order. */
interface Cursor {
  y: number;
  messages: LaidOutMessage[];
  groups: LaidOutGroupBox[];
  counter: number;
  /**
   * The furthest right anything reaches. A self-call's label hangs off the
   * right of its lifeline, past the last column's head when the call is on the
   * last participant, and was clipped by a canvas sized to the heads alone.
   */
  right: number;
}

function walk(
  steps: readonly SequenceStep[],
  cursor: Cursor,
  centers: Map<string, number>,
  depth: number,
  maxLabelWidth: number,
): void {
  for (const step of steps) {
    if (step.type === 'message') {
      const fromX = centers.get(step.from) ?? 0;
      const toX = centers.get(step.to) ?? 0;
      const selfCall = step.from === step.to;
      const { size } = DIAGRAM_TYPE.edge;
      const lines = selfCall
        ? wrapLabel(step.label, SELF_LABEL_W, size, 2)
        : wrapLabel(step.label, Math.max(80, Math.abs(toX - fromX) - 12), size, 2);
      if (selfCall) {
        cursor.right = Math.max(
          cursor.right,
          fromX + SELF_LABEL_OFFSET + Math.ceil(widestLine(lines, size)),
        );
      }
      cursor.counter += 1;
      const fullLabel = cutFrom(step.label, lines);
      cursor.messages.push({
        key: `m${String(cursor.counter)}`,
        fromX,
        toX,
        y: cursor.y + ROW_H / 2,
        lines,
        ...(fullLabel !== undefined ? { fullLabel } : {}),
        style: step.style,
        change: step.change,
        selfCall,
      });
      cursor.y += selfCall ? ROW_H + 12 : ROW_H;
      continue;
    }

    const top = cursor.y;
    cursor.y += GROUP_HEADER_H;
    cursor.counter += 1;
    const key = `g${String(cursor.counter)}`;
    const branches: LaidOutBranch[] = [];

    step.branches.forEach((branch, index) => {
      const branchTop = cursor.y;
      if (branch.label !== undefined || index > 0) cursor.y += BRANCH_LABEL_H;
      branches.push({
        y: branchTop,
        ...(branch.label !== undefined ? { label: branch.label } : {}),
        rule: index > 0,
      });
      walk(branch.steps, cursor, centers, depth + 1, maxLabelWidth);
    });

    cursor.y += GROUP_PAD_Y;
    const inset = GROUP_PAD_X * depth;
    cursor.groups.push({
      key,
      style: step.style,
      ...(step.label !== undefined ? { label: step.label } : {}),
      x: MARGIN + inset,
      y: top,
      width: maxLabelWidth - inset * 2,
      height: cursor.y - top,
      depth,
      branches,
    });
  }
}

export function layoutSequence(diagram: SequenceDiagram): SequenceLayout {
  const heads = diagram.participants.map((participant) => ({
    participant,
    box: measureHead(participant.label),
  }));

  let x = MARGIN;
  const participants: LaidOutParticipant[] = [];
  const centers = new Map<string, number>();
  const headHeight = heads.reduce((max, head) => Math.max(max, head.box.height), 0);

  for (const { participant, box } of heads) {
    const centerX = x + box.width / 2;
    centers.set(participant.id, centerX);
    participants.push({
      id: participant.id,
      lines: box.lines,
      ...(box.fullLabel !== undefined ? { fullLabel: box.fullLabel } : {}),
      x,
      y: MARGIN,
      width: box.width,
      height: headHeight,
      centerX,
      change: participant.change,
      kind: participant.kind,
      ...(participant.filename !== undefined ? { filename: participant.filename } : {}),
      ...(participant.hunkIds !== undefined ? { hunkIds: participant.hunkIds } : {}),
    });
    x += box.width + COL_GAP;
  }

  const contentWidth = x - COL_GAP - MARGIN;
  const lifelineTop = MARGIN + headHeight + LIFELINE_TOP_GAP;
  const cursor: Cursor = {
    y: lifelineTop + 8,
    messages: [],
    groups: [],
    counter: 0,
    right: MARGIN + contentWidth,
  };
  walk(diagram.steps, cursor, centers, 0, contentWidth);

  const lifelineBottom = cursor.y + LIFELINE_TAIL;
  return {
    width: cursor.right + MARGIN,
    height: lifelineBottom + MARGIN,
    uniform: hasUniformChange(diagram),
    participants,
    messages: cursor.messages,
    groups: cursor.groups,
    lifelineTop,
    lifelineBottom,
  };
}
