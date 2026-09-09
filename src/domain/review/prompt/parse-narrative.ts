import {
  InsightTypeSchema,
  NarrativeReviewSchema,
  ReviewRiskFactorImpactSchema,
  type Insight,
  type InsightType,
  type NarrativeReview,
  type ResolvedDiffHunk,
  type ReviewRiskAssessment,
  type ReviewRiskFactorImpact,
  type ReviewRiskScore,
} from '../narrative.ts';
import type { DiffHunkIndex } from './diff-hunk-catalog.ts';

/**
 * Turns the model's `<narrative_review>` block into a `NarrativeReview`.
 * Lenient on purpose: missing ids/titles are synthesised, unknown insight
 * types fall back to `context`, an out-of-range risk score drops the whole
 * assessment, and hunk ids are resolved against the prompt's index (unknown
 * or wrong-file ids are dropped). The result is validated against
 * `NarrativeReviewSchema`, so whatever lands in `reviews.content` parses
 * back at read time.
 */
export type ParseResult = { ok: true; data: NarrativeReview } | { ok: false; error: string };

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null;
}

function toInsightType(raw: unknown): InsightType {
  const parsed = InsightTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'context';
}

function toRiskScore(raw: unknown): ReviewRiskScore | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > 5) return null;
  return rounded as ReviewRiskScore;
}

function toRiskFactorImpact(raw: unknown): ReviewRiskFactorImpact {
  const parsed = ReviewRiskFactorImpactSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'neutral';
}

function sanitizeRiskAssessment(raw: unknown): ReviewRiskAssessment | undefined {
  if (!isRecord(raw)) return undefined;
  const score = toRiskScore(raw['score']);
  if (score === null) return undefined;

  const summary =
    typeof raw['summary'] === 'string' && raw['summary'].trim().length > 0
      ? raw['summary']
      : `Risk score ${String(score)} of 5.`;
  const rationale = typeof raw['rationale'] === 'string' ? raw['rationale'] : '';
  const factors = Array.isArray(raw['factors'])
    ? raw['factors']
        .filter(
          (factor): factor is Rec & { name: string; detail: string } =>
            isRecord(factor) &&
            typeof factor['name'] === 'string' &&
            typeof factor['detail'] === 'string',
        )
        .map((factor) => ({
          name: factor.name,
          impact: toRiskFactorImpact(factor['impact']),
          detail: factor.detail,
        }))
    : [];

  return { score, summary, rationale, factors };
}

function resolveHunks(chunk: Rec, hunkIndex: DiffHunkIndex | undefined): ResolvedDiffHunk[] {
  if (!hunkIndex || !Array.isArray(chunk['hunkIds'])) return [];
  const filename = typeof chunk['filename'] === 'string' ? chunk['filename'] : '';
  const deduped = new Map<string, ResolvedDiffHunk>();
  for (const hunkId of chunk['hunkIds']) {
    if (typeof hunkId !== 'string') continue;
    const hunk = hunkIndex.byId[hunkId];
    if (!hunk || hunk.filename !== filename) continue;
    deduped.set(hunk.id, {
      id: hunk.id,
      fileOrder: hunk.fileOrder,
      original: { ...hunk.original },
      modified: { ...hunk.modified },
    });
  }
  return [...deduped.values()].toSorted((a, b) => a.fileOrder - b.fileOrder);
}

function sanitizeInsights(raw: unknown): Insight[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (ins): ins is Rec & { text: string } => isRecord(ins) && typeof ins['text'] === 'string',
    )
    .map((ins) => {
      const rawTitle = ins['title'];
      const title =
        typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle.trim() : undefined;
      return {
        type: toInsightType(ins['type']),
        ...(title !== undefined ? { title } : {}),
        text: ins.text,
      };
    });
}

function sanitizeChapter(raw: Rec, index: number, hunkIndex: DiffHunkIndex | undefined): Rec {
  const n = String(index + 1);
  const id = typeof raw['id'] === 'string' && raw['id'].length > 0 ? raw['id'] : `chapter-${n}`;
  const title =
    typeof raw['title'] === 'string' && raw['title'].length > 0 ? raw['title'] : `Chapter ${n}`;
  // Older model outputs used `summary` where the schema now says `description`.
  const description =
    typeof raw['description'] === 'string'
      ? raw['description']
      : typeof raw['summary'] === 'string'
        ? raw['summary']
        : '';

  const diffChunks = (Array.isArray(raw['diffChunks']) ? raw['diffChunks'] : [])
    .filter((chunk): chunk is Rec => isRecord(chunk) && typeof chunk['filename'] === 'string')
    .map((chunk) => ({
      filename: chunk['filename'] as string,
      language: typeof chunk['language'] === 'string' ? chunk['language'] : 'plaintext',
      hunks: resolveHunks(chunk, hunkIndex),
    }))
    .filter((chunk) => chunk.hunks.length > 0);

  return { id, title, description, insights: sanitizeInsights(raw['insights']), diffChunks };
}

export function parseNarrativeReview(text: string, hunkIndex?: DiffHunkIndex): ParseResult {
  const startTag = '<narrative_review>';
  const endTag = '</narrative_review>';
  const startIdx = text.indexOf(startTag);
  // Anchored at the opening tag: a preamble that mentions the closing tag
  // before the real block must not win the search and yield an empty slice.
  const endIdx = startIdx === -1 ? -1 : text.indexOf(endTag, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    return { ok: false, error: 'Response did not contain expected <narrative_review> tags' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(startIdx + startTag.length, endIdx).trim());
  } catch {
    return { ok: false, error: 'Failed to parse narrative review JSON from response' };
  }

  if (
    !isRecord(parsed) ||
    typeof parsed['prTitle'] !== 'string' ||
    typeof parsed['overviewSummary'] !== 'string' ||
    !Array.isArray(parsed['chapters'])
  ) {
    return { ok: false, error: 'Narrative review JSON is missing required fields' };
  }

  const riskAssessment = sanitizeRiskAssessment(parsed['riskAssessment']);
  const candidate = {
    prTitle: parsed['prTitle'],
    overviewSummary: parsed['overviewSummary'],
    ...(riskAssessment ? { riskAssessment } : {}),
    chapters: parsed['chapters'].map((chapter, index) =>
      sanitizeChapter(isRecord(chapter) ? chapter : {}, index, hunkIndex),
    ),
  };

  const validated = NarrativeReviewSchema.safeParse(candidate);
  if (!validated.success) {
    return { ok: false, error: `Narrative review failed validation: ${validated.error.message}` };
  }
  return { ok: true, data: validated.data };
}
