import { writeFile } from 'node:fs/promises';
import { LOCAL_WORKING_TREE, NARRATIVE_SYSTEM_PROMPT } from '../review/prompt/instructions.ts';
import type { DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import type { ReviewFile, ReviewFileSkipReason } from '../review/narrative.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The prompt stage: `system.md` is the shared review instructions plus the
 * paragraph that says where a local run is standing; `prompt.md` is this
 * change. Rather than inlining the diff, the prompt points the agent at one
 * diff file for the whole change, and it can open anything else in its
 * working directory.
 */

/** A description longer than this stays in `context/pr.md`, with a pointer. */
const MAX_INLINE_DESCRIPTION = 8000;
const MAX_COMMIT_BODY = 600;

export async function writePrompt(
  context: RunContext,
  run: RunFiles,
  instructions: string | null,
): Promise<string> {
  const user = buildPrompt(context, run, instructions);
  await writeFile(run.system, NARRATIVE_SYSTEM_PROMPT + LOCAL_WORKING_TREE);
  await writeFile(run.prompt, user);
  return user;
}

export function buildPrompt(
  context: RunContext,
  run: RunFiles,
  instructions: string | null,
): string {
  const { target, meta, files, hunks, diffLines } = context;
  const reviewed = files.filter((file) => !file.skipped);

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
    formatSkippedSection(files),
    `## Changed Hunks (Use These IDs in diffChunks.hunkIds)\n${formatHunkCatalog(hunks)}`,
    '## Diff\n' +
      `The full patch for this change is at \`${display(run.diff)}\`, ${String(diffLines)} lines. ` +
      `Pass Read a limit of at least ${String(diffLines)} so you get the whole file in one call ` +
      'instead of paging through it. Each hunk’s id is on a `# H0001` line directly above its `@@` ' +
      'header. Read that for the change itself, and the files in your working directory for the ' +
      'code around it.',
    reviewerInstructions(instructions),
  ];
  return `${sections.filter((section) => section !== null).join('\n\n')}\n`;
}

/**
 * Last, so it is the final thing read before the work starts. The framing
 * matters: the description above is the author's, and a model told only
 * "instructions" could as easily take these as the author's too, or as licence
 * to drop the output format.
 */
function reviewerInstructions(instructions: string | null): string | null {
  if (instructions === null) return null;
  return (
    '## Reviewer’s Instructions\n' +
    'The engineer who ran this review, and will read it, added the guidance below. It comes from ' +
    'them, not from the change’s author. Let it decide where you look hardest and what you explain ' +
    `in most depth; every rule in your instructions about what to output still holds.\n\n${instructions}`
  );
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
        ? `Your working directory is the repository itself, at ${target.headLabel}. The diff file below is the source of truth for what changed.`
        : 'Your working directory is the repository itself. Only the staged changes are under review, and the diff file below is the source of truth for them.';
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

/** What each skip reason is called where the model reads it. */
const SKIP_NOTE: Record<ReviewFileSkipReason, string> = {
  generated: 'marked linguist-generated',
  vendored: 'marked linguist-vendored',
  'built-in': 'lockfile, bundle or snapshot',
  binary: 'binary',
};

type SkippedFile = ReviewFile & { skipped: ReviewFileSkipReason };

const isSkipped = (file: ReviewFile): file is SkippedFile => file.skipped !== undefined;

/**
 * The Not Reviewed block, or null when every changed file is reviewed. The
 * model sees these paths in the change it is describing either way — a commit
 * message, an import, a test name — so leaving them unmentioned invites it to
 * cite hunks that do not exist for them.
 */
function formatSkippedSection(files: readonly ReviewFile[]): string | null {
  const skipped = files.filter(isSkipped);
  if (skipped.length === 0) return null;
  return (
    `## Not Reviewed (${String(skipped.length)})\n` +
    'These files changed but are left out of the review. They have no hunks; do not cite them.\n' +
    skipped.map((file) => `  ${file.filename}  (${SKIP_NOTE[file.skipped]})`).join('\n')
  );
}

/** The Files Changed list: status, counts, path. */
function formatFileList(files: readonly ReviewFile[]): string {
  return files
    .map(
      (f) =>
        `  ${f.status.padEnd(10)} +${String(f.additions)}/-${String(f.deletions)}  ${f.filename}`,
    )
    .join('\n');
}

/** The Changed Hunks list the model cites ids from. */
function formatHunkCatalog(hunks: readonly DiffHunk[]): string {
  if (hunks.length === 0) return '  (No patch hunks were detected in the provided diff.)';
  return hunks
    .map(
      (hunk) =>
        `  ${hunk.id}  ${hunk.filename}  ${hunk.header}  original ${formatLineSpan(hunk.original.startLine, hunk.original.lineCount)}  modified ${formatLineSpan(hunk.modified.startLine, hunk.modified.lineCount)}`,
    )
    .join('\n');
}

function formatLineSpan(startLine: number, lineCount: number): string {
  if (lineCount === 0) return `L${String(startLine)} (+0)`;
  if (lineCount === 1) return `L${String(startLine)}`;
  return `L${String(startLine)}-${String(startLine + lineCount - 1)}`;
}
