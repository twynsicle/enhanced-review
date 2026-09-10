import { describe, expect, it } from 'vitest';
import {
  DiagramSchema,
  DIAGRAM_LIMITS,
  hasUniformChange,
  isGraphDiagram,
  type Diagram,
} from './diagram.ts';

function parse(raw: unknown): Diagram {
  return DiagramSchema.parse(raw);
}

const GRAPH = {
  kind: 'architecture',
  id: 'shape',
  title: 'Shape',
  caption: 'Where the change attaches to what was already there.',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  edges: [{ from: 'a', to: 'b' }],
};

describe('DiagramSchema', () => {
  it('applies the defaults the model is allowed to omit', () => {
    const diagram = parse(GRAPH);
    expect(isGraphDiagram(diagram) && diagram.direction).toBe('down');
    expect(isGraphDiagram(diagram) && diagram.nodes[0]?.kind).toBe('code');
    expect(isGraphDiagram(diagram) && diagram.nodes[0]?.change).toBe('unchanged');
    expect(isGraphDiagram(diagram) && diagram.edges[0]?.change).toBe('unchanged');
  });

  it('discriminates on kind, so a graph payload cannot pass as a sequence', () => {
    expect(DiagramSchema.safeParse({ ...GRAPH, kind: 'sequence' }).success).toBe(false);
  });

  it('accepts the three graph kinds on one structure', () => {
    for (const kind of ['architecture', 'state', 'beforeAfter']) {
      expect(DiagramSchema.safeParse({ ...GRAPH, kind }).success).toBe(true);
    }
  });

  it('rejects a caption or label that has become prose', () => {
    expect(
      DiagramSchema.safeParse({ ...GRAPH, caption: 'x'.repeat(DIAGRAM_LIMITS.captionChars + 1) })
        .success,
    ).toBe(false);
    expect(
      DiagramSchema.safeParse({
        ...GRAPH,
        nodes: [
          { id: 'a', label: 'x'.repeat(DIAGRAM_LIMITS.labelChars + 1) },
          { id: 'b', label: 'B' },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires a caption and at least two nodes', () => {
    expect(DiagramSchema.safeParse({ ...GRAPH, caption: undefined }).success).toBe(false);
    expect(DiagramSchema.safeParse({ ...GRAPH, nodes: [{ id: 'a', label: 'A' }] }).success).toBe(
      false,
    );
  });
});

describe('hasUniformChange', () => {
  it('is true for a wholly new subsystem, where emphasis would say nothing', () => {
    const diagram = parse({
      ...GRAPH,
      nodes: [
        { id: 'a', label: 'A', change: 'added' },
        { id: 'b', label: 'B', change: 'added' },
      ],
    });
    expect(hasUniformChange(diagram)).toBe(true);
  });

  it('is false once one node differs from the rest', () => {
    const diagram = parse({
      ...GRAPH,
      nodes: [
        { id: 'a', label: 'A', change: 'added' },
        { id: 'b', label: 'B', change: 'unchanged' },
      ],
    });
    expect(hasUniformChange(diagram)).toBe(false);
  });

  it('reads participants rather than nodes for a sequence', () => {
    const diagram = parse({
      kind: 'sequence',
      id: 'tick',
      title: 'One tick',
      caption: 'The three outcomes of a single pass.',
      participants: [
        { id: 'loop', label: 'Loop', change: 'added' },
        { id: 'db', label: 'Schedules', kind: 'data', change: 'modified' },
      ],
      steps: [{ type: 'message', from: 'loop', to: 'db', label: 'claim' }],
    });
    expect(isGraphDiagram(diagram)).toBe(false);
    expect(hasUniformChange(diagram)).toBe(false);
  });
});
