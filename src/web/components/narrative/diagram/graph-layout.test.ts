import { describe, expect, it } from 'vitest';
import { isGraphDiagram, type GraphDiagram } from '@/domain/review/diagram';
import {
  HAND_BEFORE_AFTER,
  REAL_ARCHITECTURE,
  REAL_BEFORE_AFTER,
  REAL_STATE,
} from '@/web/test/diagram-fixtures';
import { INITIAL_NODE_ID, layoutGraph } from './graph-layout';

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
