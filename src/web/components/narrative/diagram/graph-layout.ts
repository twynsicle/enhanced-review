import { Graph, layout as runDagre } from '@dagrejs/dagre';
import {
  hasUniformChange,
  type DiagramChange,
  type DiagramNodeKind,
  type GraphDiagram,
} from '@/domain/review/diagram';
import { DIAGRAM_TYPE, estimateTextWidth, fitCaption, widestLine, wrapLabel } from './text-metrics';

/**
 * Turns a graph diagram into coordinates. Pure: no DOM, no measurement, so it
 * runs on the server and is testable against the diagrams the model actually
 * produced.
 *
 * `beforeAfter` is laid out as two panels rather than one graph. There is no
 * side field on a node — a node's change mark already says which panels it
 * belongs in — so the before panel is drawn from the things that existed
 * before (`unchanged`, `modified`, `removed`) and the after panel from the
 * things that exist now (`unchanged`, `modified`, `added`). A modified node
 * appears in both, which is the truth: it was there, and it is different.
 */
const NODE_MIN_W = 96;
const NODE_MAX_W = 320;
const NODE_PAD_X = 14;
const NODE_PAD_Y = 11;
const NODE_MAX_LINES = 2;
const RANK_SEP = 56;
const NODE_SEP = 28;
const EDGE_SEP = 14;
const MARGIN = 14;
const GROUP_PAD_TOP = 26;
const GROUP_PAD = 16;
const PANEL_GAP = 64;
const PANEL_TITLE_H = 36;
const INITIAL_DOT = 11;
/** Where the painter starts a group's label inside its box. */
export const GROUP_LABEL_INSET = 12;

export const INITIAL_NODE_ID = '__initial__';

/*
 * dagre keeps groups and nodes in one namespace, and the schema does not:
 * the model is free to name a group after its main component, `scheduler`
 * around a node called `scheduler`. Handed to dagre as-is, that node becomes
 * its own parent and layout throws — during render, taking the reader with
 * it, and for every later visit because the review is stored. So a group is
 * given to dagre under a key no model id can take. Doing it here rather than
 * in the parser also covers the reviews already written.
 */
const groupKey = (id: string): string => `\u0000group:${id}`;

export interface Point {
  x: number;
  y: number;
}

export interface LaidOutNode {
  id: string;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  change: DiagramChange;
  kind: DiagramNodeKind;
  filename?: string;
  hunkIds?: string[];
  note?: string;
  /** The synthetic entry dot on a state machine, drawn as a filled circle. */
  isInitialDot?: boolean;
}

export interface LaidOutEdge {
  key: string;
  points: Point[];
  label?: string;
  labelX?: number;
  labelY?: number;
  labelWidth?: number;
  change: DiagramChange;
}

export interface LaidOutGroup {
  id: string;
  /** Fitted to the box: ellipsised when the group is narrower than its name. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphPanel {
  /** "Before" / "After" on a beforeAfter diagram; absent otherwise. */
  title?: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  groups: LaidOutGroup[];
}

export interface GraphLayout {
  width: number;
  height: number;
  uniform: boolean;
  panels: GraphPanel[];
}

interface NodeBox {
  lines: string[];
  width: number;
  height: number;
}

function measureNode(label: string): NodeBox {
  const { size, lineHeight } = DIAGRAM_TYPE.node;
  const inner = NODE_MAX_W - NODE_PAD_X * 2;
  const single = estimateTextWidth(label, size);
  const lines = single <= inner ? [label] : wrapLabel(label, inner, size, NODE_MAX_LINES);
  const width = Math.min(
    NODE_MAX_W,
    Math.max(NODE_MIN_W, Math.ceil(widestLine(lines, size)) + NODE_PAD_X * 2),
  );
  return { lines, width, height: lines.length * lineHeight + NODE_PAD_Y * 2 };
}

/** Which panel a node belongs to, for `beforeAfter`. */
function inBefore(change: DiagramChange): boolean {
  return change !== 'added';
}
function inAfter(change: DiagramChange): boolean {
  return change !== 'removed';
}

function layoutPanel(
  diagram: GraphDiagram,
  keep: (change: DiagramChange) => boolean,
  title?: string,
): Omit<GraphPanel, 'offsetX' | 'offsetY'> {
  const nodes = diagram.nodes.filter((node) => keep(node.change));
  const ids = new Set(nodes.map((node) => node.id));
  /*
   * An edge's own mark decides its side as well as its ends do. Filtering on
   * the ends alone put a removed edge between two surviving nodes into After
   * and an added one into Before — so a rerouted call showed both routes on
   * both sides, and an order swap drew two identical panels.
   */
  const edges = diagram.edges.filter(
    (edge) => keep(edge.change) && ids.has(edge.from) && ids.has(edge.to),
  );

  const graph = new Graph({ compound: true, multigraph: true });
  graph.setGraph({
    rankdir: diagram.direction === 'right' ? 'LR' : 'TB',
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const usedGroups = new Set(nodes.map((node) => node.group).filter((id) => id !== undefined));
  for (const group of diagram.groups ?? []) {
    if (usedGroups.has(group.id)) {
      graph.setNode(groupKey(group.id), {
        label: group.label,
        paddingTop: GROUP_PAD_TOP,
        padding: GROUP_PAD,
      });
    }
  }

  const boxes = new Map<string, NodeBox>();
  for (const node of nodes) {
    const box = measureNode(node.label);
    boxes.set(node.id, box);
    graph.setNode(node.id, { width: box.width, height: box.height });
    if (node.group !== undefined && usedGroups.has(node.group)) {
      graph.setParent(node.id, groupKey(node.group));
    }
  }

  // A state machine's entry point is a filled dot with an arrow into the
  // initial state, so it has to take part in layout rather than be drawn on.
  const initial = diagram.kind === 'state' ? nodes.find((node) => node.initial) : undefined;
  if (initial) {
    graph.setNode(INITIAL_NODE_ID, { width: INITIAL_DOT, height: INITIAL_DOT });
    graph.setEdge(INITIAL_NODE_ID, initial.id, {}, 'initial');
  }

  edges.forEach((edge, index) => {
    const label = edge.label;
    const labelWidth = label ? estimateTextWidth(label, DIAGRAM_TYPE.edge.size) : 0;
    graph.setEdge(
      edge.from,
      edge.to,
      label
        ? { width: Math.ceil(labelWidth), height: DIAGRAM_TYPE.edge.lineHeight, labelpos: 'c' }
        : {},
      `e${String(index)}`,
    );
  });

  runDagre(graph);

  const laidOutGroups: LaidOutGroup[] = [];
  for (const group of diagram.groups ?? []) {
    if (!usedGroups.has(group.id)) continue;
    const g = graph.node(groupKey(group.id)) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    laidOutGroups.push({
      id: group.id,
      // dagre sizes a group from its members, never from its name, so a long
      // name on a one-node group would run past its own border.
      label: fitCaption(group.label, g.width - GROUP_LABEL_INSET * 2),
      x: g.x - g.width / 2,
      y: g.y - g.height / 2,
      width: g.width,
      height: g.height,
    });
  }

  const laidOutNodes: LaidOutNode[] = nodes.map((node) => {
    const placed = graph.node(node.id) as { x: number; y: number };
    const box = boxes.get(node.id) as NodeBox;
    return {
      id: node.id,
      lines: box.lines,
      x: placed.x - box.width / 2,
      y: placed.y - box.height / 2,
      width: box.width,
      height: box.height,
      change: node.change,
      kind: node.kind,
      ...(node.filename !== undefined ? { filename: node.filename } : {}),
      ...(node.hunkIds !== undefined ? { hunkIds: node.hunkIds } : {}),
      ...(node.note !== undefined ? { note: node.note } : {}),
    };
  });

  if (initial) {
    const dot = graph.node(INITIAL_NODE_ID) as { x: number; y: number };
    laidOutNodes.push({
      id: INITIAL_NODE_ID,
      lines: [],
      x: dot.x - INITIAL_DOT / 2,
      y: dot.y - INITIAL_DOT / 2,
      width: INITIAL_DOT,
      height: INITIAL_DOT,
      change: initial.change,
      kind: 'code',
      isInitialDot: true,
    });
  }

  const laidOutEdges: LaidOutEdge[] = [];
  for (const graphEdge of graph.edges()) {
    const value = graph.edge(graphEdge) as {
      points: Point[];
      x?: number;
      y?: number;
      width?: number;
    };
    const isInitial = graphEdge.name === 'initial';
    const source = isInitial
      ? undefined
      : edges[Number.parseInt((graphEdge.name ?? 'e0').slice(1), 10)];
    laidOutEdges.push({
      key: `${graphEdge.v}->${graphEdge.w}:${graphEdge.name ?? ''}`,
      points: value.points,
      ...(source?.label !== undefined ? { label: source.label } : {}),
      ...(value.x !== undefined ? { labelX: value.x, labelY: value.y } : {}),
      ...(value.width !== undefined ? { labelWidth: value.width } : {}),
      change: source?.change ?? initial?.change ?? 'unchanged',
    });
  }

  const size = graph.graph() as { width: number; height: number };
  return {
    ...(title !== undefined ? { title } : {}),
    width: size.width,
    height: size.height,
    nodes: laidOutNodes,
    edges: laidOutEdges,
    groups: laidOutGroups,
  };
}

export function layoutGraph(diagram: GraphDiagram): GraphLayout {
  const uniform = hasUniformChange(diagram);

  if (diagram.kind !== 'beforeAfter') {
    const panel = layoutPanel(diagram, () => true);
    return {
      width: panel.width,
      height: panel.height,
      uniform,
      panels: [{ ...panel, offsetX: 0, offsetY: 0 }],
    };
  }

  const before = layoutPanel(diagram, inBefore, 'Before');
  const after = layoutPanel(diagram, inAfter, 'After');

  /*
   * A side with nothing on it is not drawn. When everything is new there was
   * no Before, and dagre reports an empty graph as infinite in size — which
   * came through as `width="NaN"` on the page. The schema asks for two nodes,
   * so at least one side always has something on it.
   */
  const drawn = [before, after].filter((panel) => panel.nodes.length > 0);
  if (drawn.length === 1) {
    const only = drawn[0] as typeof before;
    return {
      width: only.width,
      height: PANEL_TITLE_H + only.height,
      uniform,
      panels: [{ ...only, offsetX: 0, offsetY: PANEL_TITLE_H }],
    };
  }

  /*
   * The two panels stack across the flow, never along it. A flow that runs
   * down makes each panel tall and narrow, so they sit side by side; a flow
   * that runs right makes each one a wide strip, so they sit one above the
   * other.
   *
   * Side by side always was the first version, and it held for the
   * hand-written fixture because that flowed down. The first real
   * `beforeAfter` flowed right, and its panels came out 2154px wide in a
   * 731px frame: the reader saw "Before" and had to scroll a thousand pixels
   * to find "After", which is the one comparison this kind exists to make.
   * Stacked, the two strips share one scroll and each step sits directly
   * above its counterpart.
   */
  if (diagram.direction === 'right') {
    const afterTop = PANEL_TITLE_H + before.height + PANEL_GAP + PANEL_TITLE_H;
    return {
      width: Math.max(before.width, after.width),
      height: afterTop + after.height,
      uniform,
      panels: [
        { ...before, offsetX: 0, offsetY: PANEL_TITLE_H },
        { ...after, offsetX: 0, offsetY: afterTop },
      ],
    };
  }

  return {
    width: before.width + PANEL_GAP + after.width,
    height: PANEL_TITLE_H + Math.max(before.height, after.height),
    uniform,
    panels: [
      { ...before, offsetX: 0, offsetY: PANEL_TITLE_H },
      { ...after, offsetX: before.width + PANEL_GAP, offsetY: PANEL_TITLE_H },
    ],
  };
}

export const PANEL_TITLE_HEIGHT = PANEL_TITLE_H;
/**
 * A panel's title starts where its nodes do. dagre pads every panel by
 * MARGIN, so a title at the panel's own origin sat 14px left of the first
 * node and 4px off the frame's border — tight, and lined up with nothing.
 */
export const PANEL_TITLE_INSET = MARGIN;
