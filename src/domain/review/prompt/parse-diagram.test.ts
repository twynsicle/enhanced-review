import { describe, expect, it } from 'vitest';
import { DIAGRAM_LIMITS, isGraphDiagram, type Diagram } from '../diagram.ts';
import { findingLog, type Finding } from '../findings.ts';
import { buildDiffHunkIndex, groundingFor, type PromptGrounding } from './diff-hunk-catalog.ts';
import { sanitizeDiagram } from './parse-diagram.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
+x
@@ -20,2 +21,3 @@
+y
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,1 +5,1 @@
-z
+w
`;

const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);

/** The diagram alone, for the tests that are about what survives. */
function diagramFrom(
  raw: unknown,
  fallbackId: string,
  g: PromptGrounding | undefined,
): Diagram | undefined {
  return sanitizeDiagram(raw, fallbackId, g, findingLog());
}

/** What the same call recorded, for the tests that are about what it cost. */
function findingsFrom(raw: unknown): Finding[] {
  const log = findingLog();
  sanitizeDiagram(raw, 'd', grounding, log);
  return log.findings;
}

/** A minimum viable graph: two nodes, one edge, a caption. */
function graph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'architecture',
    title: 'Shape',
    caption: 'What the prose cannot say.',
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    edges: [{ from: 'a', to: 'b' }],
    ...overrides,
  };
}

describe('sanitizeDiagram', () => {
  it('drops a diagram with no caption', () => {
    expect(diagramFrom({ ...graph(), caption: '   ' }, 'd', grounding)).toBeUndefined();
  });

  it('drops a diagram whose kind is not one of the four', () => {
    expect(diagramFrom(graph({ kind: 'gantt' }), 'd', grounding)).toBeUndefined();
  });

  it('falls back to a per-kind title but keeps the caption verbatim', () => {
    const result = diagramFrom(graph({ title: '', kind: 'state' }), 'd', grounding);
    expect(result?.title).toBe('States');
    expect(result?.caption).toBe('What the prose cannot say.');
    expect(result?.id).toBe('d');
  });

  it('drops edges whose endpoints are not nodes', () => {
    const result = diagramFrom(
      graph({
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'ghost' },
        ],
      }),
      'd',
      grounding,
    );
    expect(result && isGraphDiagram(result) && result.edges).toHaveLength(1);
  });

  it('keeps parallel edges between the same pair, each with its own label', () => {
    const result = diagramFrom(
      graph({
        edges: [
          { from: 'a', to: 'b', label: 'launched' },
          { from: 'a', to: 'b', label: 'deferred' },
          { from: 'a', to: 'b', label: 'failed' },
        ],
      }),
      'd',
      grounding,
    );
    const labels = result && isGraphDiagram(result) ? result.edges.map((e) => e.label) : [];
    expect(labels).toEqual(['launched', 'deferred', 'failed']);
  });

  it('clears a group reference that names no group', () => {
    const result = diagramFrom(
      graph({
        groups: [{ id: 'web', label: 'Web' }],
        nodes: [
          { id: 'a', label: 'A', group: 'web' },
          { id: 'b', label: 'B', group: 'nowhere' },
        ],
      }),
      'd',
      grounding,
    );
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes[0]?.group).toBe('web');
    expect(nodes[1]?.group).toBeUndefined();
  });

  it('clears a filename the diff does not contain, keeping the node', () => {
    const result = diagramFrom(
      graph({
        nodes: [
          { id: 'a', label: 'A', filename: 'src/a.ts' },
          { id: 'b', label: 'B', filename: 'src/invented.ts' },
        ],
      }),
      'd',
      grounding,
    );
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.filename).toBe('src/a.ts');
    expect(nodes[1]?.filename).toBeUndefined();
  });

  it('keeps the filename of a file whose hunks the prompt never showed', () => {
    // A hard-truncated diff carries fewer files than the file list the model
    // took the name from, and a node grounded on one of them is right: it
    // loses the hunks it cannot name, not the page it links to.
    const truncated = groundingFor(buildDiffHunkIndex(DIFF).hunks, ['src/a.ts', 'src/cut.ts']);
    const result = diagramFrom(
      graph({
        nodes: [
          { id: 'a', label: 'A', filename: 'src/cut.ts', hunkIds: ['H0001'] },
          { id: 'b', label: 'B' },
        ],
      }),
      'd',
      truncated,
    );
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes[0]?.filename).toBe('src/cut.ts');
    expect(nodes[0]?.hunkIds).toBeUndefined();
  });

  it('keeps only hunk ids that belong to the node file', () => {
    const result = diagramFrom(
      graph({
        nodes: [
          { id: 'a', label: 'A', filename: 'src/a.ts', hunkIds: ['H0001', 'H0003', 'H9999'] },
          { id: 'b', label: 'B' },
        ],
      }),
      'd',
      grounding,
    );
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes[0]?.hunkIds).toEqual(['H0001']);
  });

  it('ignores grounding on nodes that are not code', () => {
    const result = diagramFrom(
      graph({
        nodes: [
          { id: 'a', label: 'Postgres', kind: 'data', filename: 'src/a.ts', hunkIds: ['H0001'] },
          { id: 'b', label: 'B' },
        ],
      }),
      'd',
      grounding,
    );
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes[0]?.filename).toBeUndefined();
    expect(nodes[0]?.hunkIds).toBeUndefined();
  });

  it('keeps one initial state, and only on a state machine', () => {
    const asState = diagramFrom(
      graph({
        kind: 'state',
        nodes: [
          { id: 'a', label: 'A', initial: true },
          { id: 'b', label: 'B', initial: true },
        ],
      }),
      'd',
      grounding,
    );
    const stateNodes = asState && isGraphDiagram(asState) ? asState.nodes : [];
    expect(stateNodes[0]?.initial).toBe(true);
    expect(stateNodes[1]?.initial).toBeUndefined();

    const asArchitecture = diagramFrom(
      graph({
        nodes: [
          { id: 'a', label: 'A', initial: true },
          { id: 'b', label: 'B' },
        ],
      }),
      'd',
      grounding,
    );
    const archNodes = asArchitecture && isGraphDiagram(asArchitecture) ? asArchitecture.nodes : [];
    expect(archNodes[0]?.initial).toBeUndefined();
  });

  it('drops the diagram when fewer than two nodes survive', () => {
    expect(
      diagramFrom(
        graph({
          nodes: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'dup' },
          ],
        }),
        'd',
        grounding,
      ),
    ).toBeUndefined();
  });

  it('truncates an over-long label instead of dropping the node', () => {
    const long = 'A'.repeat(80);
    const result = diagramFrom(
      graph({
        nodes: [
          { id: 'a', label: long },
          { id: 'b', label: 'B' },
        ],
      }),
      'd',
      grounding,
    );
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.label).toHaveLength(48);
  });

  it('defaults kind, change and direction', () => {
    const result = diagramFrom(graph(), 'd', grounding);
    const nodes = result && isGraphDiagram(result) ? result.nodes : [];
    expect(nodes[0]?.kind).toBe('code');
    expect(nodes[0]?.change).toBe('unchanged');
    expect(result && isGraphDiagram(result) && result.direction).toBe('down');
  });
});

function sequence(steps: unknown[]): Record<string, unknown> {
  return {
    kind: 'sequence',
    title: 'One tick',
    caption: 'The three outcomes of a single pass.',
    participants: [
      { id: 'loop', label: 'Loop' },
      { id: 'db', label: 'Schedules', kind: 'data' },
    ],
    steps,
  };
}

describe('sanitizeDiagram (sequence)', () => {
  it('drops messages that name an unknown participant', () => {
    const result = diagramFrom(
      sequence([
        { type: 'message', from: 'loop', to: 'db', label: 'claim' },
        { type: 'message', from: 'loop', to: 'ghost', label: 'vanish' },
      ]),
      'd',
      grounding,
    );
    expect(result?.kind === 'sequence' && result.steps).toHaveLength(1);
  });

  it('keeps two levels of grouping and drops the third', () => {
    const result = diagramFrom(
      sequence([
        {
          type: 'group',
          style: 'loop',
          label: 'for each claimed schedule',
          branches: [
            {
              steps: [
                {
                  type: 'group',
                  style: 'alt',
                  branches: [
                    {
                      label: 'launched',
                      steps: [
                        { type: 'message', from: 'loop', to: 'db', label: 'completeRun' },
                        { type: 'group', style: 'opt', branches: [{ steps: [] }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      'd',
      grounding,
    );

    const steps = result?.kind === 'sequence' ? result.steps : [];
    expect(steps).toHaveLength(1);
    const outer = steps[0];
    expect(outer?.type === 'group' && outer.style).toBe('loop');
    const inner = outer?.type === 'group' ? outer.branches[0]?.steps[0] : undefined;
    expect(inner?.type === 'group' && inner.style).toBe('alt');
    // The third level is gone; the message beside it survives.
    const leafSteps = inner?.type === 'group' ? inner.branches[0]?.steps : [];
    expect(leafSteps).toHaveLength(1);
    expect(leafSteps?.[0]?.type).toBe('message');
  });

  it('drops the diagram when no steps survive', () => {
    expect(
      diagramFrom(
        sequence([{ type: 'message', from: 'ghost', to: 'db', label: 'nope' }]),
        'd',
        grounding,
      ),
    ).toBeUndefined();
  });
});

describe('what a diagram repair records', () => {
  const codes = (raw: unknown) => findingsFrom(raw).map((f) => f.code);

  it('records nothing when the whole diagram is well formed', () => {
    expect(findingsFrom(graph())).toEqual([]);
  });

  it('warns once when the diagram goes whole', () => {
    const findings = findingsFrom({ ...graph(), caption: '  ' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'diagram-dropped', severity: 'warning' });
    expect(findings[0]?.message).toContain('no caption');
  });

  it('notes an edge that names a node the diagram does not have', () => {
    const findings = findingsFrom(graph({ edges: [{ from: 'a', to: 'ghost' }] }));
    expect(findings).toEqual([
      expect.objectContaining({ code: 'diagram-part-dropped', severity: 'note' }),
    ]);
    expect(findings[0]?.message).toContain('a → ghost');
  });

  it('notes a filename the change does not contain, and a hunk id that resolves to nothing', () => {
    expect(
      codes(
        graph({
          nodes: [
            { id: 'a', label: 'A', filename: 'src/ghost.ts' },
            { id: 'b', label: 'B', filename: 'src/a.ts', hunkIds: ['H0003', 'H9999'] },
          ],
        }),
      ),
    ).toEqual(['diagram-part-dropped', 'diagram-part-dropped', 'diagram-part-dropped']);
  });

  it('notes a node with no label and a group nothing declares', () => {
    expect(
      codes(
        graph({
          nodes: [{ id: 'a', label: 'A', group: 'nowhere' }, { id: 'b', label: 'B' }, { id: 'c' }],
        }),
      ),
    ).toEqual(['diagram-part-dropped', 'diagram-part-dropped']);
  });

  it('records both the parts and the whole when a diagram empties out', () => {
    const findings = findingsFrom(
      sequence([{ type: 'message', from: 'ghost', to: 'db', label: 'nope' }]),
    );
    expect(findings.map((f) => f.code)).toEqual(['diagram-part-dropped', 'diagram-dropped']);
  });
});

describe('a part of a diagram that was never an object', () => {
  it('notes a group, a node and an edge that arrived as something else', () => {
    const findings = findingsFrom(
      graph({
        groups: [null, { id: 'web', label: 'Web' }],
        nodes: ['a node', { id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [7, { from: 'a', to: 'b' }],
      }),
    );
    expect(findings.map((f) => f.message)).toEqual([
      'Diagram d dropped a group that was not an object.',
      'Diagram d dropped a node that was not an object.',
      'Diagram d dropped an edge that was not an object.',
    ]);
    expect(findings.every((f) => f.code === 'diagram-part-dropped')).toBe(true);
  });

  it('notes a participant, a step and a branch that arrived as something else', () => {
    const findings = findingsFrom({
      ...sequence([
        'not a step',
        {
          type: 'group',
          style: 'alt',
          branches: [
            null,
            {
              label: 'claimed',
              steps: [{ type: 'message', from: 'loop', to: 'db', label: 'claim' }],
            },
          ],
        },
      ]),
      participants: [
        42,
        { id: 'loop', label: 'Loop' },
        { id: 'db', label: 'Schedules', kind: 'data' },
      ],
    });
    expect(findings.map((f) => f.message)).toEqual([
      'Diagram d dropped a participant that was not an object.',
      'Diagram d dropped a step that was not an object.',
      'Diagram d dropped a branch that was not an object.',
    ]);
  });
});

describe('a value a diagram had coerced or cut to fit', () => {
  it('notes a change mark and a kind it could not read', () => {
    const findings = findingsFrom(
      graph({
        nodes: [
          { id: 'a', label: 'A', kind: 'cloud', change: 'sideways' },
          { id: 'b', label: 'B' },
        ],
      }),
    );
    expect(findings.map((f) => f.message)).toEqual([
      'Diagram d dropped the kind on node a, which was read as code.',
      'Diagram d dropped the change mark on node a, which was read as unchanged.',
    ]);
  });

  it('notes a caption, a label and a note cut to their limit', () => {
    const findings = findingsFrom(
      graph({
        caption: 'c'.repeat(DIAGRAM_LIMITS.captionChars + 12),
        nodes: [
          {
            id: 'a',
            label: 'l'.repeat(DIAGRAM_LIMITS.labelChars + 1),
            note: 'n'.repeat(DIAGRAM_LIMITS.noteChars + 3),
          },
          { id: 'b', label: 'B' },
        ],
      }),
    );
    expect(findings.map((f) => f.message)).toEqual([
      `Diagram d dropped 12 characters past the ${String(DIAGRAM_LIMITS.captionChars)} a caption allows.`,
      `Diagram d dropped 1 character past the ${String(DIAGRAM_LIMITS.labelChars)} a node label allows.`,
      `Diagram d dropped 3 characters past the ${String(DIAGRAM_LIMITS.noteChars)} a note allows.`,
    ]);
  });
});

describe('a diagram that never became one', () => {
  it('says nothing when the field was never sent', () => {
    expect(findingsFrom(undefined)).toEqual([]);
    expect(findingsFrom(null)).toEqual([]);
  });

  it('records a diagram that arrived as something other than an object', () => {
    expect(findingsFrom('a picture of the flow')).toEqual([
      {
        code: 'diagram-dropped',
        severity: 'warning',
        message: 'The diagram for d arrived as string rather than an object, so there is none.',
      },
    ]);
  });
});

describe('a default a diagram fell back to', () => {
  it('notes a direction it could not read, and says nothing when none was sent', () => {
    expect(findingsFrom(graph({ direction: 'widdershins' })).map((f) => f.message)).toEqual([
      'Diagram d dropped the direction, which was read as down.',
    ]);
    expect(findingsFrom(graph())).toEqual([]);
  });

  it('notes a group style and a message style it could not read', () => {
    const findings = findingsFrom({
      kind: 'sequence',
      caption: 'What the prose cannot say.',
      participants: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      steps: [
        { type: 'message', from: 'a', to: 'b', label: 'call', style: 'shout' },
        {
          type: 'group',
          style: 'maybe',
          branches: [{ steps: [{ type: 'message', from: 'a', to: 'b', label: 'inner' }] }],
        },
      ],
    });
    expect(findings.map((f) => f.message)).toEqual([
      'Diagram d dropped the style on the message a → b, which was read as call.',
      'Diagram d dropped the style on a group, which was read as alt.',
    ]);
  });

  it('records grounding a node could not keep', () => {
    const findings = findingsFrom(
      graph({
        nodes: [
          { id: 'a', label: 'A', kind: 'external', filename: 'src/a.ts' },
          { id: 'b', label: 'B', hunkIds: ['H0001'] },
        ],
      }),
    );
    expect(findings.map((f) => f.message)).toEqual([
      'Diagram d dropped the filename on a node of kind external, which links to no file.',
      'Diagram d dropped the hunk ids on a node that named no file.',
    ]);
  });
});
