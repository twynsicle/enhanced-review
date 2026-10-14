import { describe, expect, it } from 'vitest';
import { DIAGRAM_LIMITS } from '../diagram.ts';
import { MAX_CONTEXT_EXCERPTS, MAX_EXCERPT_LINES } from '../narrative.ts';
import { LOCAL_WORKING_TREE, NARRATIVE_SYSTEM_PROMPT } from './instructions.ts';

describe('the review instructions', () => {
  it('ask for the tagged block and the hunks each chapter cites', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('<narrative_review>');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"hunks": [');
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('working tree');
  });

  it('define both attention tiers, a test’s cases and types as read, and what the hints are for', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"tier": "read | skim —');
    for (const tier of ['read', 'skim']) {
      expect(NARRATIVE_SYSTEM_PROMPT).toContain(`- "${tier}":`);
    }
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('mechanical"');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('When unsure, choose "read"');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('A test case is read whole');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('no hunk is skim for its brackets');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      'type declarations, interfaces, schemas and signatures',
    );
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('[whitespace only]');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('is shown as skim whatever tier you give it');
  });

  it('order the chapters cause first, since the order of the list is the reading order', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      'the reader never meets a consequence before its cause',
    );
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('the shared wiring-and-docs chapter comes last');
  });

  it('ask for a reading plan of chapter ids, a brief within a standard, and no minutes', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"readingPlan": {');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"brief": ["string — the id of a chapter');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"standard": ["string — the id of a chapter');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('Reading plan:');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('It holds every brief chapter');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('do not estimate a time');
  });

  it('offer excerpts of unchanged code, capped as the parser caps them, never of a changed file', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"contextExcerpts": "optional list');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('"startLine": "number');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('Affected unchanged code:');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      `up to ${String(MAX_CONTEXT_EXCERPTS)} excerpts of code the change does not touch`,
    );
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(`at most ${String(MAX_EXCERPT_LINES)}`);
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      'Never a file listed in Files Changed or Not Reviewed',
    );
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('Only lines you have read');
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
