import {
  formatCommits,
  formatFileList,
  formatHunkCatalog,
  formatSkippedSection,
} from '../cli/prompt.ts';
import { ATTENTION_TIERS } from '../review/prompt/instructions.ts';
import type { SkimCase } from './skim-case.ts';

/**
 * The skim eval's prompt: the review's own tiering rules, verbatim, asked for
 * on their own. The answer is only the tiers, so a sample costs one short
 * turn rather than a whole review, and the change is inlined rather than left
 * on disk for the agent to open, so the run needs no tools and no working
 * tree. What it cannot reproduce is the full run's chapters, which the model
 * decides before it tiers; the full review is still the last word.
 */
export const SKIM_SYSTEM_PROMPT = `You are a senior software engineer reviewing a pull request. The review's chapters are written separately; your one job here is the attention tier of every changed hunk, judged by the rules below, which are the rules the full review follows.

${ATTENTION_TIERS}

Output a JSON object wrapped in <hunk_tiers> tags, with one entry for every hunk in the Changed Hunks list, in that order:

{
  "hunks": [
    {
      "id": "string — a hunk ID from the Changed Hunks list (example: H0007)",
      "tier": "read | skim",
      "skimReason": "string — a skim hunk only, as the rules above describe. Omit it on a read hunk"
    }
  ]
}

Read the whole diff before tiering anything: a hunk's tier depends on what the rest of the change does with it. Output ONLY the <hunk_tiers> JSON block — no other text.`;

export function buildSkimPrompt(skimCase: SkimCase, diff: string): string {
  const reviewed = skimCase.files.filter((file) => !file.skipped);
  const sections = [
    `# ${skimCase.title}`,
    `## Description\n${skimCase.description ?? '(no description)'}`,
    formatCommits(skimCase.commits),
    `## Files Changed (${String(reviewed.length)})\n${formatFileList(reviewed)}`,
    formatSkippedSection(skimCase.files),
    `## Changed Hunks\n${formatHunkCatalog(skimCase.hunks)}`,
    '## Diff\n' +
      'The full patch for this change. Each hunk’s id is on a `# H0001` line directly above its `@@` header.\n\n' +
      diff,
  ];
  return `${sections.filter((section) => section !== null).join('\n\n')}\n`;
}
