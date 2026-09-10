import { DIAGRAM_LIMITS } from '../diagram.ts';
import { isExcludedFromAI } from './ai-file-filter.ts';
import { buildDiffHunkIndex, type DiffHunkIndex } from './diff-hunk-catalog.ts';
import type { PrData } from './types.ts';

/**
 * Builds the system + user prompt for the narrative review. The diff is
 * filtered (lockfiles etc.), truncated per file above a token budget, and
 * indexed into hunk ids the model must cite; the returned `hunkIndex` lets
 * `parseNarrativeReview` resolve those ids back to line spans.
 */
const MAX_DIFF_TOKENS = 80_000;
const CHARS_PER_TOKEN = 4;
const MAX_DIFF_CHARS = MAX_DIFF_TOKENS * CHARS_PER_TOKEN;
const KEEP_LINES = 80;

export interface NarrativePromptResult {
  system: string;
  user: string;
  wasTruncated: boolean;
  hunkIndex: DiffHunkIndex;
}

const SYSTEM_PROMPT = `You are a senior software engineer reviewing a pull request. Your job is to produce a structured narrative review that organizes the PR changes into logical chapters.

Output a JSON object wrapped in <narrative_review> tags. The JSON must conform to this schema:

{
  "prTitle": "string — the PR title",
  "overviewSummary": "string — 2-4 sentence high-level summary of the entire PR",
  "overviewDiagram": "optional object — see Diagrams below. Only for the shape of the whole change",
  "riskAssessment": {
    "score": "number — integer 1-5",
    "summary": "string — one sentence reviewer-facing risk headline",
    "rationale": "string — 2-4 sentences explaining why this score was chosen and what a human reviewer should calibrate for",
    "factors": [
      {
        "name": "string — short factor label such as 'User impact', 'Data safety', 'Complexity', 'Test coverage', or 'Operational risk'",
        "impact": "raises | lowers | neutral",
        "detail": "string — one sentence explaining how this factor affected the score"
      }
    ]
  },
  "chapters": [
    {
      "id": "string — unique slug like 'auth-middleware'",
      "title": "string — short chapter label, usually 2-6 words",
      "description": "string — 2-4 sentences explaining what changed, why it likely changed, and the tradeoffs or alternatives the author likely considered",
      "insights": [
        {
          "type": "context | rationale | highlight | reference",
          "title": "string — short 4-10 word headline naming the takeaway",
          "text": "string — concise reviewer aid, 1-2 sentences"
        }
      ],
      "diffChunks": [
        {
          "filename": "string — path of the file (must match a path from the Files Changed list)",
          "language": "string — programming language",
          "hunkIds": ["string — one or more hunk IDs from the Changed Hunks list (example: H0007)"]
        }
      ],
      "diagram": "optional object — see Diagrams below. At most one per chapter"
    }
  ]
}

Guidelines:
- Produce 2–12 chapters depending on PR complexity. For small PRs (1–2 files, under 20 lines changed), 2–3 chapters is appropriate.
- Group related changes together logically (e.g. "API types", "database migration", "UI components").
- Each chapter should tell a coherent story about one aspect of the change.
- Chapter titles must be short labels that work in a sidebar, e.g., "Auth Gate", "Runner Cleanup", "Reader Layout". Do not write long takeaway sentences as titles.
- Each chapter description should be readable by a product-minded reviewer: cover (a) what was done, (b) why it was likely done, and (c) tradeoffs or alternatives the author likely considered. Keep it specific but not overly technical.
- Each chapter must have 1–3 insights. Insight types are reviewer aids (not AI opinions):
  - "context": background info to help the reviewer understand the change
  - "rationale": why this approach was chosen over alternatives
  - "highlight": key change the reviewer should focus on
  - "reference": pointers to related code, docs, or patterns
- Each insight has a "title" (4–10 word phrase that names the takeaway, e.g., "Buffer can grow unbounded under reconnect") and a "text" (the 1–2 sentence explanation). Title and text must not duplicate each other — the title is the headline, the text is the supporting detail.
- Prefer concise insights. If an idea needs more explanation, put the broader explanation in the chapter description and keep the insight focused.
- Each diffChunk must use only hunk IDs listed in "Changed Hunks". Do not invent IDs.
- Keep hunk IDs file-consistent: only use hunk IDs that belong to the same filename as the diffChunk.
- Prefer one diffChunk per file per chapter; group relevant hunk IDs in that chunk.
- Always include riskAssessment. Choose the score as a reviewer-effort signal, not as a judgment of author skill.
- Risk score 1: no meaningful functional behavior change, such as copy-only edits, styling-only tweaks, comments/docs, formatting, config that only affects local development, or isolated test/tooling changes with no production path.
- Risk score 2: functional logic changed, but the blast radius is low and user impact is minor or easy to observe. Examples include a small behavior change on one frontend page, guarded UX polish, or localized logic where failure has a clear workaround.
- Risk score 3: moderate complexity or internal/business-facing impact. Examples include internal operator tools, more involved developer tooling, cross-module refactors, or behavior that affects internal users more than external customers.
- Risk score 4: meaningful external user, data, availability, or operational risk. Examples include production user workflows, persistence or migration changes, auth/permissions, billing, background jobs, broad API behavior, data corruption risk, downtime risk, or changes that could require manual data repair.
- Risk score 5: compliance, privacy, security, legal, or regulated-data risk. Examples include PII/PHI/secrets, access-control bypass potential, audit/compliance obligations, encryption/authentication primitives, payment/legal exposure, or incidents likely to involve legal/security/compliance responders.
- Adjust the baseline score for modifiers: add weight for large diffs, many changed files, subtle algorithms, concurrency, migrations, distributed systems, ambiguous requirements, weak rollout/rollback story, or sparse tests around risky paths.
- Lower the score only when the evidence is strong: focused change size, excellent relevant tests, feature flags, backward-compatible migration strategy, clear rollback, or mostly mechanical changes.
- In riskAssessment.factors include 3-6 concrete factors. Cover size/complexity and test coverage when the diff gives evidence either way. Say when evidence is absent rather than inventing test coverage.

Diagrams:

A diagram is optional and usually absent. There are two places one may go: "overviewDiagram" on the review, and "diagram" on a chapter — at most one each. Every diagram has:

{
  "id": "string — unique slug",
  "title": "string — short figure label, 2-5 words",
  "caption": "string — one or two sentences saying what this picture shows that the prose cannot",
  "kind": "architecture | state | beforeAfter | sequence"
}

"architecture", "state" and "beforeAfter" share one structure:

{
  "direction": "down | right",
  "groups": [{ "id": "string", "label": "string" }],
  "nodes": [
    {
      "id": "string — unique within this diagram",
      "label": "string — a name, not a sentence",
      "kind": "code | data | external | actor",
      "change": "added | removed | modified | unchanged",
      "group": "string — id of one of the groups above (optional)",
      "filename": "string — a path from Files Changed. Only on 'code' nodes (optional)",
      "hunkIds": ["string — ids from Changed Hunks belonging to that same file (optional)"],
      "initial": "boolean — the entry state. State machines only, at most one per diagram",
      "note": "string — a short aside (optional)"
    }
  ],
  "edges": [{ "from": "node id", "to": "node id", "label": "string (optional)", "change": "added | removed | modified | unchanged" }]
}

"sequence" has its own structure:

{
  "participants": [{ "id": "string", "label": "string", "kind": "code | data | external | actor", "change": "...", "filename": "optional", "hunkIds": ["optional"] }],
  "steps": [
    { "type": "message", "from": "participant id", "to": "participant id", "label": "string", "style": "call | return", "change": "..." },
    { "type": "group", "style": "alt | opt | loop", "label": "string (optional)", "branches": [{ "label": "string (optional)", "steps": ["message or group"] }] }
  ]
}

Rules for diagrams:
- A diagram here describes a CHANGE, not a system. Mark every node and edge with what this PR did to it. A diagram in which nothing is added, removed or modified is documentation rather than review, and should not be included at all.
- Include one only when it shows something the prose cannot: a shape, an ordering, a branch, a cycle, a boundary being crossed. If a chapter is a list of small edits, omit the diagram. Most chapters should not have one.
- Prefer diagrams that put branches, alternatives or parallel paths beside each other. A reviewer checks symmetry without being asked, so a picture that makes an asymmetry visible has done a reviewer's work for them.
- The caption is what earns the diagram its place. If you cannot write a sentence saying what the picture shows that your text does not, omit the diagram.
- Ground what you can. A "code" node may carry a "filename" from the Files Changed list and "hunkIds" from the Changed Hunks list for that same file. A node that is not code — a database table, an external service, a person — must not carry a filename. Never invent a path or an id.
- Keep labels short: node and group labels at most ${String(DIAGRAM_LIMITS.labelChars)} characters, edge labels at most ${String(DIAGRAM_LIMITS.edgeLabelChars)}, sequence message labels at most ${String(DIAGRAM_LIMITS.messageChars)}, captions at most ${String(DIAGRAM_LIMITS.captionChars)}. A label that has become a sentence belongs in the caption or the chapter description instead.
- Prefer the smallest diagram that makes the point — 6 to 15 nodes is usually right. Larger is allowed when the structure genuinely needs it, but every node costs the reader something.
- Sequence groups may nest one level deep (a loop containing an alt) and no further.
- For "beforeAfter", draw a single graph and let the change marks split it: the before side is drawn from "unchanged" and "removed" nodes, the after side from "unchanged", "added" and "modified".
- Use "overviewDiagram" only for the shape of the whole change and how the chapters relate to each other. Anything narrower belongs to the chapter it explains.
- Draw only what the diff and the PR description support. Where the description explains a flow, a lifecycle, a rollout or a decision, that is the best material for a diagram — but do not invent structure you cannot see in either.
- Output ONLY the <narrative_review> JSON tags — no other text.`;

/** Trims the largest file patches first, keeping their head and tail. */
function truncateDiff(diff: string): { result: string; wasTruncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { result: diff, wasTruncated: false };

  const patches = diff.split(/(?=^diff --git )/m);
  const bySize = patches
    .map((p, index) => ({ index, size: p.length }))
    .toSorted((a, b) => b.size - a.size);

  let totalSize = diff.length;
  const truncated = [...patches];
  for (const { index, size } of bySize) {
    if (totalSize <= MAX_DIFF_CHARS) break;
    const lines = (truncated[index] ?? '').split('\n');
    if (lines.length <= KEEP_LINES * 2 + 5) continue;

    const kept = [
      ...lines.slice(0, 4 + KEEP_LINES),
      `[... ${String(lines.length - KEEP_LINES * 2 - 4)} lines truncated ...]`,
      ...lines.slice(-KEEP_LINES),
    ];
    const newPatch = kept.join('\n');
    totalSize -= size - newPatch.length;
    truncated[index] = newPatch;
  }

  const result = truncated.join('');
  if (result.length > MAX_DIFF_CHARS) {
    return {
      result: result.slice(0, MAX_DIFF_CHARS) + '\n[... diff truncated due to size ...]',
      wasTruncated: true,
    };
  }
  return { result, wasTruncated: true };
}

function filterDiffPatches(diff: string, shouldExclude: (filename: string) => boolean): string {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((patch) => {
      const match = /^diff --git a\/.+ b\/(.+)/.exec(patch);
      return !match || !shouldExclude(match[1] ?? '');
    })
    .join('');
}

function formatLineSpan(startLine: number, lineCount: number): string {
  if (lineCount === 0) return `L${String(startLine)} (+0)`;
  if (lineCount === 1) return `L${String(startLine)}`;
  return `L${String(startLine)}-${String(startLine + lineCount - 1)}`;
}

export function buildNarrativePrompt(
  prData: PrData,
  userPatterns?: readonly string[],
): NarrativePromptResult {
  const shouldExclude = (filename: string): boolean => isExcludedFromAI(filename, userPatterns);
  const filteredFiles = prData.files.filter((f) => !shouldExclude(f.filename));

  const fileList = filteredFiles
    .map(
      (f) =>
        `  ${f.status.padEnd(10)} +${String(f.additions)}/-${String(f.deletions)}  ${f.filename}`,
    )
    .join('\n');

  const { result: diff, wasTruncated } = truncateDiff(
    filterDiffPatches(prData.diff, shouldExclude),
  );
  const hunkIndex = buildDiffHunkIndex(diff);
  const hunkCatalog =
    hunkIndex.hunks.length === 0
      ? '  (No patch hunks were detected in the provided diff.)'
      : hunkIndex.hunks
          .map(
            (hunk) =>
              `  ${hunk.id}  ${hunk.filename}  ${hunk.header}  original ${formatLineSpan(hunk.original.startLine, hunk.original.lineCount)}  modified ${formatLineSpan(hunk.modified.startLine, hunk.modified.lineCount)}`,
          )
          .join('\n');

  let user = `# Pull Request: ${prData.title}

**Author**: ${prData.author}
**Branches**: ${prData.headRefName} → ${prData.baseRefName}

## Description
${prData.body || '(no description)'}

Use the description as author-provided intent. If it mentions user impact, rollout, linked issues, testing strategy, or alternatives, reflect that context in overviewSummary and chapter descriptions.

## Files Changed (${String(filteredFiles.length)})
${fileList}

## Changed Hunks (Use These IDs in diffChunks.hunkIds)
${hunkCatalog}

## Full Diff
\`\`\`
${diff}
\`\`\``;

  if (wasTruncated) {
    user +=
      '\n\nNote: Some large file diffs were truncated. Focus your narrative on the available content.';
  }

  return { system: SYSTEM_PROMPT, user, wasTruncated, hunkIndex };
}
