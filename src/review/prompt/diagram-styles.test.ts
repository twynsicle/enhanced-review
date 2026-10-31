import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIAGRAM_STYLE,
  DIAGRAM_STYLES,
  diagramStyleSection,
  isDiagramStyle,
} from './diagram-styles.ts';

describe('diagram styles', () => {
  it('default to the mechanism style and know only the two', () => {
    expect(DEFAULT_DIAGRAM_STYLE).toBe('mechanism');
    expect(DIAGRAM_STYLES).toEqual(['mechanism', 'files']);
    expect(isDiagramStyle('files')).toBe(true);
    expect(isDiagramStyle('architecture')).toBe(false);
  });

  it('ask the mechanism style for responsibilities and the untouched parts, grounded outside the change', () => {
    const section = diagramStyleSection('mechanism');
    expect(section).toMatch(/^## Diagram Style/);
    expect(section).toContain('Name every node by its responsibility');
    expect(section).toContain('from anywhere in the repository');
    expect(section).toContain('only once you have read it');
  });

  it('keep the files style to the change’s own files', () => {
    const section = diagramStyleSection('files');
    expect(section).toContain('from the Files Changed list');
    expect(section).not.toContain('anywhere in the repository');
    expect(section).toContain('Draw only what the diff and the PR description support');
  });
});
