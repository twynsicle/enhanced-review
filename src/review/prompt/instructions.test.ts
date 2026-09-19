import { describe, expect, it } from 'vitest';
import { DIAGRAM_LIMITS } from '../diagram.ts';
import { LOCAL_WORKING_TREE, NARRATIVE_SYSTEM_PROMPT } from './instructions.ts';

describe('the review instructions', () => {
  it('ask for the tagged block and the hunk ids', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('<narrative_review>');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('hunkIds');
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('working tree');
  });

  it('state the diagram contract with the real limits, not a template hole', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"overviewDiagram"');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('architecture | state | beforeAfter | sequence');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('describes a CHANGE, not a system');
    // The caps come from DIAGRAM_LIMITS so the prompt cannot drift from the
    // schema that rejects what it asks for.
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      `at most ${String(DIAGRAM_LIMITS.labelChars)} characters`,
    );
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('${');
  });

  it('do not both discourage and encourage diagrams', () => {
    /*
     * The first two runs against a 45-file PR each produced exactly one
     * chapter diagram out of eleven, because the section opened with "usually
     * absent" and said "most chapters should not have one", then contradicted
     * itself twelve rules later with "do not ration them to one". The model
     * settled the contradiction by rationing. Whatever the wording, the
     * section must not carry both halves of that argument at once.
     */
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('usually absent');
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('Most chapters should not have one');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('Do not ration diagrams to one per review');
  });

  it('give every diagram kind a trigger to match against', () => {
    // `beforeAfter` went unused across both real runs: it had no cue a model
    // could match a chapter to, only a definition.
    for (const kind of ['architecture', 'beforeAfter', 'state', 'sequence']) {
      expect(NARRATIVE_SYSTEM_PROMPT).toContain(`- "${kind}":`);
    }
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('previously X, now Y');
  });

  it('close by saying where the agent is standing, and to answer with the block only', () => {
    expect(LOCAL_WORKING_TREE).toContain('the repository this change belongs to');
    expect(LOCAL_WORKING_TREE).toContain('diff file');
    expect(LOCAL_WORKING_TREE).toContain('git blame');
    expect(LOCAL_WORKING_TREE).toContain('Output only the <narrative_review> JSON block');
  });
});
