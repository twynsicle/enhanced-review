import { writeFile } from 'node:fs/promises';
import type { ReviewFileSkipReason } from '../domain/review/narrative.ts';
import {
  formatFileList,
  formatHunkCatalog,
  NARRATIVE_SYSTEM_PROMPT,
} from '../domain/review/prompt/narrative-prompt.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The prompt stage: `system.md` is the hosted review's instructions,
 * unchanged for now (Phase 4 adapts the wording to a local run); `prompt.md`
 * is this change, delivered the local way. The hosted prompt inlines the
 * diff; here the agent reads one hunk file per reviewed file, and can open
 * anything else in its working directory.
 */

/** A description longer than this stays in `context/pr.md`, with a pointer. */
const MAX_INLINE_DESCRIPTION = 8000;
const MAX_COMMIT_BODY = 600;

const SKIP_NOTE: Record<ReviewFileSkipReason, string> = {
  generated: 'marked linguist-generated',
  vendored: 'marked linguist-vendored',
  'built-in': 'lockfile, bundle or snapshot',
  binary: 'binary',
};

export async function writePrompt(context: RunContext, run: RunFiles): Promise<string> {
  const user = buildPrompt(context, run);
  await writeFile(run.system, NARRATIVE_SYSTEM_PROMPT);
  await writeFile(run.prompt, user);
  return user;
}

export function buildPrompt(context: RunContext, run: RunFiles): string {
  const { target, meta, files, hunks } = context;
  const reviewed = files.filter((file) => !file.skipped);
  const skipped = files.filter((file) => file.skipped);

  const sections = [
    heading(context),
    [
      `**Repository**: ${meta.repo}`,
      meta.authorLogin ? `**Author**: ${meta.authorLogin}` : null,
      meta.headRefName && meta.baseRefName
        ? `**Branches**: ${meta.headRefName} → ${meta.baseRefName}`
        : null,
      `**Range**: ${target.baseSha.slice(0, 7)}..${target.headSha.slice(0, 7)}, from ${target.baseLabel} to ${target.headLabel}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    description(context, run),
    commits(context),
    workingDirectory(context, run),
    `## Files Changed (${String(reviewed.length)})\n${formatFileList(reviewed)}${renames(context)}`,
    skipped.length > 0
      ? `## Not Reviewed (${String(skipped.length)})\n` +
        'These files changed but are left out of the review. They have no hunks; do not cite them.\n' +
        skipped.map((file) => `  ${file.filename}  (${SKIP_NOTE[file.skipped!]})`).join('\n')
      : null,
    `## Changed Hunks (Use These IDs in diffChunks.hunkIds)\n${formatHunkCatalog(hunks)}`,
    '## Hunk Files\n' +
      `The patch for each file in Files Changed is at \`${display(run.diffDir)}/<path>.diff\`, ` +
      'with each hunk’s id on a `# H0001` line directly above its `@@` header. Read those for the ' +
      'change itself, and the files in your working directory for the code around it.',
  ];
  return `${sections.filter((section) => section !== null).join('\n\n')}\n`;
}

function heading({ target, meta }: RunContext): string {
  if (meta.prNumber !== null) return `# Pull Request #${String(meta.prNumber)}: ${meta.title}`;
  if (target.kind === 'staged') return `# ${meta.title}`;
  return `# Branch: ${meta.title}`;
}

function description({ meta, commits: list }: RunContext, run: RunFiles): string {
  const intent =
    'Use the description as author-provided intent. If it mentions user impact, rollout, linked ' +
    'issues, testing strategy, or alternatives, reflect that context in overviewSummary and chapter ' +
    'descriptions.';
  if (!meta.description) {
    return list.length > 0
      ? '## Description\n(no description — the commit messages below are the best statement of intent)'
      : '## Description\n(no description)';
  }
  if (meta.description.length > MAX_INLINE_DESCRIPTION) {
    return `## Description\nThe author’s description is long; read it in \`${display(run.pr)}\`.\n\n${intent}`;
  }
  return `## Description\n${meta.description}\n\n${intent}`;
}

function commits({ commits: list }: RunContext): string | null {
  if (list.length === 0) return null;
  const lines = list.map((commit) => {
    const body =
      commit.body.length > MAX_COMMIT_BODY
        ? `${commit.body.slice(0, MAX_COMMIT_BODY)}…`
        : commit.body;
    const indented = body ? `\n${body.replace(/^/gm, '    ')}` : '';
    return `- ${commit.sha.slice(0, 7)} ${commit.subject}${indented}`;
  });
  return `## Commits (${String(list.length)})\n${lines.join('\n')}`;
}

function workingDirectory({ target, dirty }: RunContext, run: RunFiles): string {
  const where =
    target.kind === 'pr'
      ? `Your working directory is a temporary checkout of the pull request’s head commit (${target.headSha.slice(0, 7)}). Every file in it is as the pull request leaves it.`
      : target.kind === 'branch'
        ? `Your working directory is the repository itself, at ${target.headLabel}. The hunk files below are the source of truth for what changed.`
        : 'Your working directory is the repository itself. Only the staged changes are under review, and the hunk files below are the source of truth for them.';
  const extra =
    dirty.length > 0
      ? `\n\nThese paths hold changes on disk that are not part of this review, so what you read there may differ from the reviewed version:\n${dirty.map((name) => `  ${name}`).join('\n')}`
      : '';
  return (
    `## Where You Are\n${where}${extra}\n\n` +
    `Ignore the \`er-reviews/\` folder, except for this run’s own folder, \`${display(run.folder)}\`.`
  );
}

function renames({ renamedFrom }: RunContext): string {
  const entries = Object.entries(renamedFrom);
  if (entries.length === 0) return '';
  return `\n\nRenamed or copied:\n${entries.map(([to, from]) => `  ${to}  (from ${from})`).join('\n')}`;
}

/** Paths in the prompt use forward slashes, which every tool accepts. */
function display(file: string): string {
  return file.replaceAll('\\', '/');
}
