import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_WORKING_TREE,
  NARRATIVE_SYSTEM_PROMPT,
  SERVER_WORKING_TREE,
} from './instructions.ts';
import { buildNarrativePrompt } from './narrative-prompt.ts';
import type { PrData } from './types.ts';

/**
 * The fixture is a recording of the hosted review's assembled prompt, system
 * and user. The instructions are shared with local mode, so this is what keeps
 * a change made for one path from silently rewriting what the other asks the
 * model. A deliberate change to the prompt regenerates the fixture in the same
 * commit.
 */
const FIXTURE = path.join(import.meta.dirname, '__fixtures__', 'server-prompt.txt');
const SEPARATOR = '\n@@ USER @@\n';

const PR_DATA: PrData = {
  title: 'Add a cadence scheduler',
  body: 'Reviews run on a cadence.\n\n- arms a target once\n- reviews it repeatedly',
  author: 'octocat',
  baseRefName: 'main',
  headRefName: 'feat/cadence',
  files: [
    { filename: 'src/scheduler/cadence.ts', status: 'modified', additions: 12, deletions: 3 },
    {
      filename: 'package-lock.json',
      status: 'modified',
      additions: 400,
      deletions: 20,
      skipped: 'built-in',
    },
  ],
  diff: [
    'diff --git a/src/scheduler/cadence.ts b/src/scheduler/cadence.ts',
    '--- a/src/scheduler/cadence.ts',
    '+++ b/src/scheduler/cadence.ts',
    '@@ -7,0 +8,2 @@',
    '+  const due = nextDue(target);',
    '+  if (due === null) return;',
    '@@ -16,3 +26,1 @@',
    '-  const a = 1;',
    '-  const b = 2;',
    '-  return a + b;',
    '+  return 3;',
    '',
  ].join('\n'),
};

describe('the shared review instructions', () => {
  it('assemble the hosted prompt byte for byte', () => {
    const [system, user] = readFileSync(FIXTURE, 'utf8').split(SEPARATOR);
    const built = buildNarrativePrompt(PR_DATA);

    expect(built.system).toBe(system);
    expect(built.user).toBe(user);
  });

  it('tell each path where it is standing, and both to answer with the block only', () => {
    expect(SERVER_WORKING_TREE).toContain('freshly cloned working tree');
    expect(LOCAL_WORKING_TREE).toContain('the repository this change belongs to');
    expect(LOCAL_WORKING_TREE).toContain('hunk files');
    // Local runs get history, which the hosted sandbox has no use for.
    expect(LOCAL_WORKING_TREE).toContain('git blame');
    expect(SERVER_WORKING_TREE).not.toContain('Bash');
    for (const boundary of [SERVER_WORKING_TREE, LOCAL_WORKING_TREE]) {
      expect(boundary).toContain('Output only the <narrative_review> JSON block');
    }
  });

  it('are the same instructions for both, whatever is appended to them', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('<narrative_review>');
    expect(NARRATIVE_SYSTEM_PROMPT).not.toContain('working tree');
  });
});
