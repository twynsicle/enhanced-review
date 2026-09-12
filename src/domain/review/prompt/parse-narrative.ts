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
import type { PromptGrounding } from './diff-hunk-catalog.ts';
import { sanitizeDiagram } from './parse-diagram.ts';

/**
 * Turns the model's `<narrative_review>` block into a `NarrativeReview`.
 * Lenient on purpose: missing ids/titles are synthesised, unknown insight
 * types fall back to `context`, an out-of-range risk score drops the whole
 * assessment, and hunk ids are resolved against what the prompt showed
 * (unknown or wrong-file ids are dropped). Diagrams go through `parse-diagram.ts`,
 * which validates each one on its own so a malformed picture cannot take the
 * review down with it. The result is validated against
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

function resolveHunks(chunk: Rec, grounding: PromptGrounding | undefined): ResolvedDiffHunk[] {
  if (!grounding || !Array.isArray(chunk['hunkIds'])) return [];
  const filename = typeof chunk['filename'] === 'string' ? chunk['filename'] : '';
  const deduped = new Map<string, ResolvedDiffHunk>();
  for (const hunkId of chunk['hunkIds']) {
    if (typeof hunkId !== 'string') continue;
    const hunk = grounding.shown.byId[hunkId];
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

function sanitizeChapter(raw: Rec, index: number, grounding: PromptGrounding | undefined): Rec {
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
      hunks: resolveHunks(chunk, grounding),
    }))
    .filter((chunk) => chunk.hunks.length > 0);

  const diagram = sanitizeDiagram(raw['diagram'], `${id}-diagram`, grounding);

  return {
    id,
    title,
    description,
    insights: sanitizeInsights(raw['insights']),
    diffChunks,
    ...(diagram ? { diagram } : {}),
  };
}

/** A real backslash, kept out of the source the way `terminal.ts` does it. */
const BACKSLASH = String.fromCharCode(92);

/**
 * The one repair worth making to the model's JSON: a quote inside a string
 * that it forgot to escape (`a "no hunks" message`). On a long answer that is
 * the commonest way the JSON goes wrong, and it used to throw away a whole
 * review, so a failed parse gets one more attempt with those quotes escaped.
 *
 * Valid JSON passes through unchanged, because this only rewrites a quote
 * that is *not* followed by the punctuation a string may legally end with.
 * That is also the limit of it: a literal quote sitting directly before a
 * comma (`he said "hi", then left`) still reads as the end of the string.
 */
export function escapeStrayQuotes(json: string): string {
  const out: string[] = [];
  let inString = false;

  for (let i = 0; i < json.length; i += 1) {
    const char = json[i]!;
    if (!inString) {
      if (char === '"') inString = true;
      out.push(char);
      continue;
    }
    if (char === BACKSLASH) {
      // An escape sequence: whatever follows it belongs to the string.
      out.push(char, json[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (char === '"') {
      if (endsString(json, i + 1)) inString = false;
      else out.push(BACKSLASH);
    }
    out.push(char);
  }
  return out.join('');
}

/** Whether a string ends here: the next thing is punctuation JSON allows after one. */
function endsString(json: string, from: number): boolean {
  for (let i = from; i < json.length; i += 1) {
    const char = json[i]!;
    if (
      char === ' ' ||
      char === String.fromCharCode(10) ||
      char === String.fromCharCode(13) ||
      char === String.fromCharCode(9)
    ) {
      continue;
    }
    return char === ',' || char === ':' || char === '}' || char === ']';
  }
  return true;
}

export function parseNarrativeReview(text: string, grounding?: PromptGrounding): ParseResult {
  const startTag = '<narrative_review>';
  const endTag = '</narrative_review>';
  const startIdx = text.indexOf(startTag);
  // Anchored at the opening tag: a preamble that mentions the closing tag
  // before the real block must not win the search and yield an empty slice.
  const endIdx = startIdx === -1 ? -1 : text.indexOf(endTag, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    return { ok: false, error: 'Response did not contain expected <narrative_review> tags' };
  }

  const body = text.slice(startIdx + startTag.length, endIdx).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    try {
      parsed = JSON.parse(escapeStrayQuotes(body));
    } catch {
      return { ok: false, error: 'Failed to parse narrative review JSON from response' };
    }
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
  const overviewDiagram = sanitizeDiagram(parsed['overviewDiagram'], 'overview-diagram', grounding);
  const candidate = {
    prTitle: parsed['prTitle'],
    overviewSummary: parsed['overviewSummary'],
    ...(riskAssessment ? { riskAssessment } : {}),
    ...(overviewDiagram ? { overviewDiagram } : {}),
    chapters: parsed['chapters'].map((chapter, index) =>
      sanitizeChapter(isRecord(chapter) ? chapter : {}, index, grounding),
    ),
  };

  const validated = NarrativeReviewSchema.safeParse(candidate);
  if (!validated.success) {
    return { ok: false, error: `Narrative review failed validation: ${validated.error.message}` };
  }
  return { ok: true, data: validated.data };
}
