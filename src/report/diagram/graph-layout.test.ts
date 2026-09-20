import { describe, expect, it } from 'vitest';
import { isGraphDiagram, type GraphDiagram } from '@/review/diagram';
import {
  HAND_BEFORE_AFTER,
  REAL_ARCHITECTURE,
  REAL_BEFORE_AFTER,
  REAL_STATE,
} from '@/report/test/diagram-fixtures';
import { GROUP_LABEL_INSET, INITIAL_NODE_ID, layoutGraph } from './graph-layout';
import { estimateCaptionWidth } from './text-metrics';

function asGraph(diagram: typeof REAL_ARCHITECTURE): GraphDiagram {
  if (!isGraphDiagram(diagram)) throw new Error('fixture is not a graph diagram');
  return diagram;
}

function panelIds(panel: { nodes: { id: string }[] } | undefined): Set<string> {
  return new Set(panel?.nodes.map((node) => node.id));
}

const architecture = asGraph(REAL_ARCHITECTURE);
const state = asGraph(REAL_STATE);
const beforeAfter = asGraph(HAND_BEFORE_AFTER);
const realBeforeAfter = asGraph(REAL_BEFORE_AFTER);

describe('layoutGraph', () => {
  it('places every node inside the reported canvas', () => {
    const layout = layoutGraph(architecture);
    expect(layout.width).toBeGreaterThan(0);
    for (const panel of layout.panels) {
      for (const node of panel.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x + node.width).toBeLessThanOrEqual(layout.width + 1);
        expect(node.y + node.height).toBeLessThanOrEqual(layout.height + 1);
      }
    }
  });

  it('draws a box round every group that has a member, and none that do not', () => {
    const layout = layoutGraph(architecture);
    const panel = layout.panels[0];
    const used = new Set(architecture.nodes.map((node) => node.group).filter(Boolean));
    expect(new Set(panel?.groups.map((g) => g.id))).toEqual(used);
    for (const group of panel?.groups ?? []) {
      expect(group.width).toBeGreaterThan(0);
      expect(group.height).toBeGreaterThan(0);
    }
  });

  it('carries grounding and change marks through to the laid-out node', () => {
    const panel = layoutGraph(architecture).panels[0];
    const grounded = panel?.nodes.filter((node) => node.filename !== undefined) ?? [];
    expect(grounded.length).toBe(
      architecture.nodes.filter((node) => node.filename !== undefined).length,
    );
    expect(panel?.nodes.some((node) => node.change === 'modified')).toBe(true);
  });

  it('keeps parallel edges apart', () => {
    // The real state machine returns to `active` three different ways; three
    // edges between one pair must not be drawn on top of each other.
    const panel = layoutGraph(state).panels[0];
    const parallel = (panel?.edges ?? []).filter((edge) => edge.key.startsWith('running->active'));
    expect(parallel.length).toBeGreaterThan(1);
    const midpoints = parallel.map((edge) => JSON.stringify(edge.points[1]));
    expect(new Set(midpoints).size).toBe(midpoints.length);
  });

  it('gives a state machine an entry dot only when a node is marked initial', () => {
    // The real fixture marks one; stripping it must take the dot away too.
    expect(layoutGraph(state).panels[0]?.nodes.some((n) => n.id === INITIAL_NODE_ID)).toBe(true);

    const withoutInitial = layoutGraph({
      ...state,
      nodes: state.nodes.map(({ initial: _initial, ...node }) => node),
    });
    expect(withoutInitial.panels[0]?.nodes.some((n) => n.id === INITIAL_NODE_ID)).toBe(false);
  });

  it('does not give an architecture diagram an entry dot, marked or not', () => {
    const marked = layoutGraph({
      ...architecture,
      nodes: architecture.nodes.map((node, i) => (i === 0 ? { ...node, initial: true } : node)),
    });
    expect(marked.panels[0]?.nodes.some((n) => n.id === INITIAL_NODE_ID)).toBe(false);
  });

  it('reports uniform change for a wholly new subsystem', () => {
    expect(layoutGraph(state).uniform).toBe(true);
    expect(layoutGraph(architecture).uniform).toBe(false);
  });

  it('lays out a group that shares its id with a node', () => {
    /*
     * dagre keeps groups and nodes in one namespace, so a group called `db`
     * holding a node called `db` made the node its own parent and dagre threw
     * — during render, with nothing above it to catch, on every visit to the
     * review. The schema does not forbid the collision and should not have to.
     */
    const colliding: GraphDiagram = {
      ...architecture,
      groups: [{ id: 'db', label: 'Database' }],
      nodes: [
        { id: 'db', label: 'Postgres', kind: 'data', change: 'unchanged', group: 'db' },
        { id: 'api', label: 'API', kind: 'code', change: 'modified' },
      ],
      edges: [{ from: 'api', to: 'db', change: 'unchanged' }],
    };
    const panel = layoutGraph(colliding).panels[0];
    expect(panel?.groups.map((g) => g.id)).toEqual(['db']);
    expect(panel?.nodes.map((n) => n.id).toSorted()).toEqual(['api', 'db']);
    expect(panel?.edges).toHaveLength(1);
  });

  it('cuts a group label that would run out of its box', () => {
    const narrow: GraphDiagram = {
      ...architecture,
      groups: [{ id: 'g', label: 'An improbably long name for a group of one small node' }],
      nodes: [
        { id: 'a', label: 'A', kind: 'code', change: 'unchanged', group: 'g' },
        { id: 'b', label: 'B', kind: 'code', change: 'added' },
      ],
      edges: [],
    };
    const group = layoutGraph(narrow).panels[0]?.groups[0];
    expect(group?.label).toMatch(/…$/);
    expect(group?.fullLabel).toBe('An improbably long name for a group of one small node');
    expect(estimateCaptionWidth(group?.label ?? '')).toBeLessThanOrEqual(
      (group?.width ?? 0) - GROUP_LABEL_INSET * 2,
    );
  });
});

describe('layoutGraph (beforeAfter)', () => {
  it('splits into two panels off the change marks alone', () => {
    const layout = layoutGraph(beforeAfter);
    expect(layout.panels.map((p) => p.title)).toEqual(['Before', 'After']);
  });

  it('puts what existed before in the first panel and what exists now in the second', () => {
    const [before, after] = layoutGraph(beforeAfter).panels;
    // `removed` is only on the before side, `added` only on the after side,
    // and `modified` — which existed and is different — is on both.
    expect(panelIds(before)).toEqual(new Set(['recover', 'serve', 'legacy']));
    expect(panelIds(after)).toEqual(new Set(['recover', 'release', 'arm', 'serve']));
  });

  it('drops edges whose other end is not on that side', () => {
    const [before, after] = layoutGraph(beforeAfter).panels;
    expect(before?.edges.every((e) => !e.key.includes('release'))).toBe(true);
    expect(after?.edges.every((e) => !e.key.includes('legacy'))).toBe(true);
  });

  it('puts each edge on the side its own mark says, not only where its ends are', () => {
    // Two steps that swapped order: both ends exist on both sides, so only
    // the edges' marks can tell the panels apart. Without that, they matched.
    const swapped: GraphDiagram = {
      ...beforeAfter,
      nodes: [
        { id: 'parse', label: 'parse', kind: 'code', change: 'unchanged' },
        { id: 'check', label: 'check', kind: 'code', change: 'unchanged' },
      ],
      edges: [
        { from: 'parse', to: 'check', change: 'removed' },
        { from: 'check', to: 'parse', change: 'added' },
      ],
    };
    const [before, after] = layoutGraph(swapped).panels;
    expect(before?.edges.map((e) => e.key.split(':')[0])).toEqual(['parse->check']);
    expect(after?.edges.map((e) => e.key.split(':')[0])).toEqual(['check->parse']);
  });

  it('draws one panel, with finite bounds, when a side would be empty', () => {
    // Everything added: there is no "before" to draw, and an empty dagre
    // graph reports a non-finite size that became `NaN` in the viewBox.
    const allNew: GraphDiagram = {
      ...beforeAfter,
      nodes: [
        { id: 'a', label: 'A', kind: 'code', change: 'added' },
        { id: 'b', label: 'B', kind: 'code', change: 'added' },
      ],
      edges: [{ from: 'a', to: 'b', change: 'added' }],
    };
    const layout = layoutGraph(allNew);
    expect(layout.panels.map((p) => p.title)).toEqual(['After']);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('sets the panels side by side when the flow runs down', () => {
    const layout = layoutGraph({ ...beforeAfter, direction: 'down' });
    const [before, after] = layout.panels;
    expect(after?.offsetX ?? 0).toBeGreaterThanOrEqual(before?.width ?? 0);
    expect(after?.offsetY).toBe(before?.offsetY);
  });

  it('stacks the panels when the flow runs right, as the real one does', () => {
    /*
     * Side by side was the only arrangement until the first real
     * `beforeAfter`, which flowed right: two wide strips end to end came out
     * 2154px across a 731px frame, and "After" began a thousand pixels past
     * where the reader could see. Panels go across the flow, never along it.
     */
    const layout = layoutGraph(realBeforeAfter);
    const [before, after] = layout.panels;
    expect(after?.offsetX).toBe(0);
    expect(after?.offsetY ?? 0).toBeGreaterThanOrEqual(
      (before?.offsetY ?? 0) + (before?.height ?? 0),
    );
    expect(layout.width).toBe(Math.max(before?.width ?? 0, after?.width ?? 0));
  });
});
