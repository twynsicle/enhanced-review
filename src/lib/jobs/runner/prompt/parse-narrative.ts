import type {
  Insight,
  InsightType,
  NarrativeReview,
  ReviewRiskAssessment,
  ReviewRiskFactorImpact,
  ReviewRiskScore,
  ResolvedDiffHunk,
} from '@enhanced-review/review-types';

import type { DiffHunkIndex } from './diff-hunk-catalog';

export type ParseResult = { ok: true; data: NarrativeReview } | { ok: false; error: string };

const INSIGHT_TYPES: readonly InsightType[] = ['context', 'rationale', 'highlight', 'reference'];
const RISK_FACTOR_IMPACTS: readonly ReviewRiskFactorImpact[] = ['raises', 'lowers', 'neutral'];

function toInsightType(raw: unknown): InsightType {
  return typeof raw === 'string' && (INSIGHT_TYPES as readonly string[]).includes(raw)
    ? (raw as InsightType)
    : 'context';
}

function toRiskScore(raw: unknown): ReviewRiskScore | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > 5) return null;
  return rounded as ReviewRiskScore;
}

function toRiskFactorImpact(raw: unknown): ReviewRiskFactorImpact {
  return typeof raw === 'string' && (RISK_FACTOR_IMPACTS as readonly string[]).includes(raw)
    ? (raw as ReviewRiskFactorImpact)
    : 'neutral';
}

function sanitizeRiskAssessment(raw: unknown): ReviewRiskAssessment | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const record = raw as Record<string, unknown>;
  const score = toRiskScore(record['score']);
  if (score === null) return undefined;

  const summary =
    typeof record['summary'] === 'string' && record['summary'].trim().length > 0
      ? record['summary']
      : `Risk score ${String(score)} of 5.`;
  const rationale = typeof record['rationale'] === 'string' ? record['rationale'] : '';
  const factors = Array.isArray(record['factors'])
    ? record['factors']
        .filter(
          (factor) =>
            typeof factor === 'object' &&
            factor !== null &&
            typeof (factor as Record<string, unknown>)['name'] === 'string' &&
            typeof (factor as Record<string, unknown>)['detail'] === 'string',
        )
        .map((factor) => {
          const factorRecord = factor as Record<string, unknown>;
          return {
            name: factorRecord['name'] as string,
            impact: toRiskFactorImpact(factorRecord['impact']),
            detail: factorRecord['detail'] as string,
          };
        })
    : [];

  return { score, summary, rationale, factors };
}

function extractHunksFromHunkIds(
  chunk: Record<string, unknown>,
  hunkIndex: DiffHunkIndex | undefined,
): ResolvedDiffHunk[] {
  if (!hunkIndex) return [];
  if (!Array.isArray(chunk['hunkIds'])) return [];

  const filename = typeof chunk['filename'] === 'string' ? chunk['filename'] : '';
  const hunkIds = (chunk['hunkIds'] as unknown[]).filter(
    (id): id is string => typeof id === 'string',
  );
  const dedupedHunks = new Map<string, ResolvedDiffHunk>();

  for (const hunkId of hunkIds) {
    const hunk = hunkIndex.byId[hunkId];
    if (!hunk) continue;
    if (hunk.filename !== filename) continue;
    dedupedHunks.set(hunk.id, {
      id: hunk.id,
      fileOrder: hunk.fileOrder,
      original: { ...hunk.original },
      modified: { ...hunk.modified },
    });
  }

  return [...dedupedHunks.values()].sort((a, b) => a.fileOrder - b.fileOrder);
}

export function parseNarrativeReview(text: string, hunkIndex?: DiffHunkIndex): ParseResult {
  const startTag = '<narrative_review>';
  const endTag = '</narrative_review>';
  const startIdx = text.indexOf(startTag);
  const endIdx = text.indexOf(endTag);

  if (startIdx === -1 || endIdx === -1) {
    return { ok: false, error: 'Response did not contain expected <narrative_review> tags' };
  }

  const jsonStr = text.slice(startIdx + startTag.length, endIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, error: 'Failed to parse narrative review JSON from response' };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as NarrativeReview).prTitle !== 'string' ||
    typeof (parsed as NarrativeReview).overviewSummary !== 'string' ||
    !Array.isArray((parsed as NarrativeReview).chapters)
  ) {
    return { ok: false, error: 'Narrative review JSON is missing required fields' };
  }

  (parsed as NarrativeReview).riskAssessment = sanitizeRiskAssessment(
    (parsed as Record<string, unknown>)['riskAssessment'],
  );

  type RawChapter = Record<string, unknown> & { summary?: string };
  const rawChapters = (parsed as { chapters: RawChapter[] }).chapters;

  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i]!;

    if (typeof ch['id'] !== 'string' || (ch['id'] as string).length === 0) {
      ch['id'] = `chapter-${String(i + 1)}`;
    }
    if (typeof ch['title'] !== 'string' || (ch['title'] as string).length === 0) {
      ch['title'] = `Chapter ${String(i + 1)}`;
    }
    if (typeof ch['description'] !== 'string') {
      ch['description'] = typeof ch.summary === 'string' ? ch.summary : '';
    }

    if (!Array.isArray(ch['insights']) && typeof ch.summary === 'string') {
      ch['insights'] = [];
      delete ch.summary;
    }

    if (!Array.isArray(ch['insights'])) {
      ch['insights'] = [];
    }
    ch['insights'] = (ch['insights'] as unknown[])
      .filter(
        (ins) =>
          typeof ins === 'object' &&
          ins !== null &&
          typeof (ins as Record<string, unknown>)['text'] === 'string',
      )
      .map((ins) => {
        const record = ins as Record<string, unknown>;
        const rawTitle = record['title'];
        const title =
          typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle.trim() : undefined;
        return {
          type: toInsightType(record['type']),
          ...(title !== undefined ? { title } : {}),
          text: record['text'] as string,
        } satisfies Insight;
      });

    if (!Array.isArray(ch['diffChunks'])) {
      ch['diffChunks'] = [];
    }
    ch['diffChunks'] = (ch['diffChunks'] as unknown[]).filter(
      (chunk) =>
        typeof chunk === 'object' &&
        chunk !== null &&
        typeof (chunk as Record<string, unknown>)['filename'] === 'string',
    );

    for (const chunk of ch['diffChunks'] as Record<string, unknown>[]) {
      if (typeof chunk['language'] !== 'string') {
        chunk['language'] = 'plaintext';
      }
      chunk['hunks'] = extractHunksFromHunkIds(chunk, hunkIndex);
    }

    ch['diffChunks'] = (ch['diffChunks'] as Record<string, unknown>[]).filter(
      (chunk) => Array.isArray(chunk['hunks']) && (chunk['hunks'] as ResolvedDiffHunk[]).length > 0,
    );
  }

  return { ok: true, data: parsed as NarrativeReview };
}
