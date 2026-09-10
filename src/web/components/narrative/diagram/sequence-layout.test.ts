import { describe, expect, it } from 'vitest';
import { isGraphDiagram, type SequenceDiagram } from '@/domain/review/diagram';
import { REAL_SEQUENCE } from '@/web/test/diagram-fixtures';
import { layoutSequence } from './sequence-layout';
import { DIAGRAM_TYPE, estimateTextWidth, wrapLabel } from './text-metrics';

if (isGraphDiagram(REAL_SEQUENCE)) throw new Error('fixture is not a sequence diagram');
const sequence: SequenceDiagram = REAL_SEQUENCE;

describe('layoutSequence', () => {
  it('gives every participant a column, left to right in order', () => {
    const layout = layoutSequence(sequence);
    expect(layout.participants.map((p) => p.id)).toEqual(sequence.participants.map((p) => p.id));
    const xs = layout.participants.map((p) => p.centerX);
    expect(xs).toEqual([...xs].toSorted((a, b) => a - b));
  });

  it('runs lifelines from below the heads to below the last row', () => {
    const layout = layoutSequence(sequence);
    const headBottom = Math.max(...layout.participants.map((p) => p.y + p.height));
    expect(layout.lifelineTop).toBeGreaterThanOrEqual(headBottom);
    expect(layout.lifelineBottom).toBeGreaterThan(layout.lifelineTop);
  });

  it('frames the alt group around all three of its branches', () => {
    // The whole point of this diagram: three outcomes in one frame, so a
    // reviewer reads them against each other.
    const layout = layoutSequence(sequence);
    const alt = layout.groups.find((group) => group.style === 'alt');
    expect(alt).toBeDefined();
    expect(alt?.branches).toHaveLength(3);
    expect(alt?.branches.map((b) => b.label)).toEqual(['launched', 'owner at job cap', 'threw']);
  });

  it('separates branches after the first with a rule, and not the first', () => {
    const alt = layoutSequence(sequence).groups.find((group) => group.style === 'alt');
    expect(alt?.branches.map((b) => b.rule)).toEqual([false, true, true]);
  });

  it('keeps every message inside its group frame', () => {
    const layout = layoutSequence(sequence);
    const alt = layout.groups.find((group) => group.style === 'alt');
    if (!alt) throw new Error('no alt group');
    const inside = layout.messages.filter((m) => m.y > alt.y && m.y < alt.y + alt.height);
    expect(inside).toHaveLength(3);
  });

  it('orders messages down the page', () => {
    const ys = layoutSequence(sequence).messages.map((m) => m.y);
    expect(ys).toEqual([...ys].toSorted((a, b) => a - b));
  });

  it('reports the canvas as big enough for everything in it', () => {
    const layout = layoutSequence(sequence);
    for (const participant of layout.participants) {
      expect(participant.x + participant.width).toBeLessThanOrEqual(layout.width);
    }
    for (const group of layout.groups) {
      expect(group.y + group.height).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe('text metrics', () => {
  it('never wraps past the line limit', () => {
    const lines = wrapLabel('a fairly long participant label that will not fit', 90, 13, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) expect(estimateTextWidth(line, 13)).toBeLessThanOrEqual(90);
  });

  it('ellipsises rather than dropping text it cannot fit', () => {
    const lines = wrapLabel('one two three four five six seven eight nine ten', 60, 13, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('…')).toBe(true);
  });

  it('breaks a single word too long for the line', () => {
    const lines = wrapLabel('supercalifragilisticexpialidocious', 50, 13, 1);
    expect(estimateTextWidth(lines[0] ?? '', 13)).toBeLessThanOrEqual(50);
  });

  it('holds the type scale — nothing below the smallest step', () => {
    expect(DIAGRAM_TYPE.edge.size).toBeGreaterThanOrEqual(11);
    expect(DIAGRAM_TYPE.node.size).toBeGreaterThanOrEqual(11);
  });
});
