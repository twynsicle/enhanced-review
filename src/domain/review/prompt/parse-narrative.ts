import { plural } from '../../../common/plural.ts';
import { findingLog, type Finding, type FindingLog } from '../findings.ts';
import {
  InsightTypeSchema,
  MAX_JUDGEMENT_CALLS,
  NarrativeReviewSchema,
  ReviewRiskFactorImpactSchema,
  type DiffChunk,
  type Insight,
  type JudgementCall,
  type NarrativeReview,
  type Prose,
  type ResolvedDiffHunk,
  type ReviewRiskAssessment,
  type ReviewRiskFactorImpact,
  type ReviewRiskScore,
} from '../narrative.ts';
import type { DiffHunk, PromptGrounding } from './diff-hunk-catalog.ts';
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
 *
 * Every one of those repairs is recorded as a `Finding` (`findings.ts` holds
 * the severity of each), which is what keeps leniency from being silence: the
 * answer is accepted, and what it cost travels with it.
 */
export type ParseResult =
  { ok: true; data: NarrativeReview; findings: Finding[] } | { ok: false; findings: Finding[] };

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null;
}

/**
 * Every disqualifying path ends here, having already recorded why. A caller
 * reads the reason off the findings, the first fatal one first, so the
 * sentence a person is shown is the sentence the record holds.
 */
function fail(log: FindingLog): ParseResult {
  return { ok: false, findings: log.findings };
}

/** A value the model actually sent, as against a field it simply left out. */
function arrived(raw: unknown): boolean {
  return raw !== undefined && raw !== null;
}

function toRiskScore(raw: unknown, log: FindingLog): ReviewRiskScore | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > 5) return null;
  if (rounded !== raw) {
    log.add(
      'risk-part-dropped',
      `The risk score arrived as ${String(raw)} and was rounded to ${String(rounded)}.`,
    );
  }
  return rounded as ReviewRiskScore;
}

function toRiskFactorImpact(raw: unknown, name: string, log: FindingLog): ReviewRiskFactorImpact {
  const parsed = ReviewRiskFactorImpactSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  log.add(
    'risk-part-dropped',
    `The risk factor "${name}" gave an impact this review cannot read; it was taken as neutral.`,
  );
  return 'neutral';
}

function sanitizeRiskAssessment(raw: unknown, log: FindingLog): ReviewRiskAssessment | undefined {
  // Nothing sent is not something dropped, and the reader draws no risk
  // section either way; only an assessment that arrived and could not be used
  // is worth telling anyone about.
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    log.add('risk-dropped', 'The risk assessment was not an object, so the review has none.');
    return undefined;
  }
  const score = toRiskScore(raw['score'], log);
  if (score === null) {
    log.add(
      'risk-dropped',
      'The risk assessment scored nothing between 1 and 5, so the review has none.',
    );
    return undefined;
  }

  let summary: string;
  if (typeof raw['summary'] === 'string' && raw['summary'].trim().length > 0) {
    summary = raw['summary'];
  } else {
    summary = `Risk score ${String(score)} of 5.`;
    log.add(
      'risk-part-dropped',
      'The risk assessment had no summary, so the score is the summary.',
    );
  }
  if (arrived(raw['rationale']) && typeof raw['rationale'] !== 'string') {
    log.add(
      'risk-part-dropped',
      'The risk assessment gave a rationale that was not text, so it has none.',
    );
  }
  const rationale = typeof raw['rationale'] === 'string' ? raw['rationale'] : '';
  if (raw['factors'] !== undefined && !Array.isArray(raw['factors'])) {
    log.add(
      'risk-part-dropped',
      'The risk assessment gave its factors as something other than a list, so it has none.',
    );
  }
  const rawFactors: unknown[] = Array.isArray(raw['factors']) ? raw['factors'] : [];
  const factors = rawFactors.flatMap((factor) => {
    if (
      !isRecord(factor) ||
      typeof factor['name'] !== 'string' ||
      typeof factor['detail'] !== 'string'
    ) {
      log.add('risk-part-dropped', 'A risk factor with no name or no detail was dropped.');
      return [];
    }
    const name = factor['name'];
    return [
      { name, impact: toRiskFactorImpact(factor['impact'], name, log), detail: factor['detail'] },
    ];
  });

  return { score, summary, rationale, factors };
}

function resolveHunks(
  chunk: Rec,
  grounding: PromptGrounding | undefined,
  chapterId: string,
  log: FindingLog,
): ResolvedDiffHunk[] {
  // Nothing to resolve against: no prompt showed this answer any hunks, so a
  // chunk citing none of them is not a chunk that lost anything.
  if (!grounding) return [];
  const filename = typeof chunk['filename'] === 'string' ? chunk['filename'] : '';
  const rawIds: unknown[] = Array.isArray(chunk['hunkIds']) ? chunk['hunkIds'] : [];
  if (rawIds.length === 0) {
    // Recorded here rather than where the empty chunk is finally dropped:
    // this is the last place that knows which file's diff went with it.
    log.add(
      'chunk-dropped',
      `Chapter ${chapterId} showed ${filename || 'a file it did not name'} with no hunk id to resolve, so that diff was dropped.`,
      { chapterId, ...(filename ? { filename } : {}) },
    );
    return [];
  }
  const where = { chapterId, ...(filename ? { filename } : {}) };
  const deduped = new Map<string, ResolvedDiffHunk>();
  let repeated = 0;
  for (const hunkId of rawIds) {
    const hunk = typeof hunkId === 'string' ? grounding.shown.byId[hunkId] : undefined;
    if (!hunk || hunk.filename !== filename) {
      log.add(
        'hunk-id-dropped',
        `Chapter ${chapterId} cited ${typeof hunkId === 'string' ? hunkId : 'a hunk id that is not a string'} for ${filename || 'a chunk with no filename'}, which resolved against nothing.`,
        where,
      );
      continue;
    }
    if (deduped.has(hunk.id)) repeated += 1;
    deduped.set(hunk.id, {
      id: hunk.id,
      fileOrder: hunk.fileOrder,
      original: { ...hunk.original },
      modified: { ...hunk.modified },
    });
  }
  if (repeated > 0) {
    log.add(
      'chunks-merged',
      `Chapter ${chapterId} cited ${plural(repeated, 'hunk')} twice over in its ${filename} chunk; the repeats were dropped.`,
      where,
    );
  }
  return [...deduped.values()].toSorted((a, b) => a.fileOrder - b.fileOrder);
}

/**
 * A `{ lede, body }` passage. Nothing written is `undefined` rather than a
 * passage of empty strings, so the reader can tell "no prose" from "a lede
 * that is a space".
 *
 * A body arriving without a lede is promoted to one, and so is a bare string,
 * the shape the model drops back to when it forgets the object. Both are
 * leniency toward a nondeterministic producer, not compatibility with an older
 * stored shape: a passage that is dropped for arriving in the wrong field
 * leaves a chapter with a title, diffs and no prose, and a review missing what
 * it was meant to say still looks finished to whoever reads it.
 */
function sanitizeProse(
  raw: unknown,
  whose: string,
  log: FindingLog,
  location: { chapterId?: string } = {},
): Prose | undefined {
  // Nothing sent is not something lost, and the caller decides what a missing
  // passage means. A passage that arrived and turned out to be unreadable is a
  // loss, and one nobody would see from the page: the chapter keeps its title
  // and its diffs and simply says nothing.
  const nothing = (): undefined => {
    if (raw !== undefined) {
      log.add('prose-dropped', `${whose} arrived with nothing readable in it.`, location);
    }
    return undefined;
  };

  if (typeof raw === 'string') {
    const only = raw.trim();
    if (only.length === 0) return nothing();
    log.add(
      'prose-promoted',
      `${whose} arrived as a bare string, which became its lede.`,
      location,
    );
    return { lede: only };
  }
  if (!isRecord(raw)) return nothing();
  const lede = typeof raw['lede'] === 'string' ? raw['lede'].trim() : '';
  const body = typeof raw['body'] === 'string' ? raw['body'].trim() : '';
  if (lede.length === 0) {
    if (body.length === 0) return nothing();
    log.add('prose-promoted', `${whose} arrived with a body and no lede.`, location);
    return { lede: body };
  }
  return { lede, ...(body.length > 0 ? { body } : {}) };
}

/**
 * `anchors` are the paths this chapter cites. An insight naming one keeps its
 * `filename` and is drawn on that diff; an insight naming anything else loses
 * the anchor and joins the chapter's list, because the card it asked for is
 * not on the page and an insight nobody sees is worse than one in the wrong
 * place.
 */
function sanitizeInsights(
  raw: unknown,
  anchors: ReadonlySet<string>,
  chapterId: string,
  log: FindingLog,
): Insight[] {
  if (arrived(raw) && !Array.isArray(raw)) {
    log.add(
      'insight-dropped',
      `Chapter ${chapterId} gave its insights as something other than a list, so it has none.`,
      { chapterId },
    );
  }
  const rawInsights: unknown[] = Array.isArray(raw) ? raw : [];
  return rawInsights.flatMap((ins) => {
    const text = isRecord(ins) && typeof ins['text'] === 'string' ? ins['text'].trim() : '';
    if (!isRecord(ins) || text.length === 0) {
      log.add('insight-dropped', `An insight in chapter ${chapterId} had no text.`, { chapterId });
      return [];
    }
    const parsedType = InsightTypeSchema.safeParse(ins['type']);
    if (!parsedType.success) {
      const named =
        typeof ins['type'] === 'string' ? `the type "${ins['type']}"` : 'no usable type';
      log.add(
        'insight-type-unknown',
        `An insight in chapter ${chapterId} gave ${named}; it was read as context.`,
        { chapterId },
      );
    }
    const rawTitle = ins['title'];
    const title =
      typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle.trim() : undefined;
    const rawFilename = ins['filename'];
    let filename: string | undefined;
    if (typeof rawFilename === 'string') {
      if (anchors.has(rawFilename)) filename = rawFilename;
      else {
        log.add(
          'insight-anchor-dropped',
          `An insight in chapter ${chapterId} is anchored to ${rawFilename}, which the chapter does not show; it joins the chapter's list instead.`,
          { chapterId, filename: rawFilename },
        );
      }
    }
    return [
      {
        type: parsedType.success ? parsedType.data : 'context',
        ...(title !== undefined ? { title } : {}),
        text,
        ...(filename !== undefined ? { filename } : {}),
      },
    ];
  });
}

/** The hunks of one file a judgement call points at, in file order. */
function resolveJudgementHunks(
  raw: unknown,
  filename: string,
  title: string,
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): DiffHunk[] {
  const rawIds: unknown[] = Array.isArray(raw) ? raw : [];
  const deduped = new Map<string, DiffHunk>();
  for (const hunkId of rawIds) {
    const hunk = typeof hunkId === 'string' ? grounding?.shown.byId[hunkId] : undefined;
    if (!hunk || hunk.filename !== filename) {
      log.add(
        'judgement-hunk-id-dropped',
        `The judgement call "${title}" cited ${typeof hunkId === 'string' ? hunkId : 'a hunk id that is not a string'} for ${filename}, which resolved against nothing.`,
        { filename },
      );
      continue;
    }
    deduped.set(hunk.id, hunk);
  }
  return [...deduped.values()].toSorted((a, b) => a.fileOrder - b.fileOrder);
}

/**
 * The review's judgement calls, each held to the one place it can be drawn.
 *
 * `cited` are the paths the chapters ended up showing, so the check is against
 * the diff cards that exist on the page rather than against the change: a
 * question anchored to a file no chapter shows has no card to sit beside, and
 * it is dropped rather than hoisted somewhere the reader meets it before any
 * code. That is the opposite call to the one an insight gets — an insight that
 * loses its anchor still says something on its own, while a question about
 * lines the reader cannot see is a question about nothing.
 *
 * The cap is applied here and not left to the schema, because the schema can
 * only refuse the whole review, and a model that asks five good questions has
 * not produced an invalid answer.
 */
function sanitizeJudgementCalls(
  raw: unknown,
  cited: ReadonlySet<string>,
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): JudgementCall[] {
  if (arrived(raw) && !Array.isArray(raw)) {
    log.add(
      'judgement-call-dropped',
      'The judgement calls arrived as something other than a list, so the review asks nothing.',
    );
  }
  const rawCalls: unknown[] = Array.isArray(raw) ? raw : [];
  const kept = rawCalls.flatMap<JudgementCall>((call) => {
    if (!isRecord(call)) {
      log.add(
        'judgement-call-dropped',
        'A judgement call arrived as something other than an object.',
      );
      return [];
    }
    const title = typeof call['title'] === 'string' ? call['title'].trim() : '';
    const text = typeof call['text'] === 'string' ? call['text'].trim() : '';
    if (title.length === 0 || text.length === 0) {
      log.add(
        'judgement-call-dropped',
        `A judgement call arrived with no ${title.length === 0 ? 'title' : 'text'}, so there is no question to ask.`,
      );
      return [];
    }
    const filename = typeof call['filename'] === 'string' ? call['filename'] : '';
    if (!cited.has(filename)) {
      log.add(
        'judgement-call-dropped',
        `The judgement call "${title}" is anchored to ${filename || 'no file'}, which no chapter shows, so there is nowhere to ask it.`,
        filename ? { filename } : {},
      );
      return [];
    }
    const [first, ...rest] = resolveJudgementHunks(
      call['hunkIds'],
      filename,
      title,
      grounding,
      log,
    );
    if (first === undefined) {
      log.add(
        'judgement-call-dropped',
        `The judgement call "${title}" cites no hunk of ${filename} that resolved against the diff.`,
        { filename },
      );
      return [];
    }
    return [
      {
        title,
        text,
        filename,
        hunkIds: [first.id, ...rest.map((hunk) => hunk.id)] as [string, ...string[]],
      },
    ];
  });

  if (kept.length <= MAX_JUDGEMENT_CALLS) return kept;
  log.add(
    'judgement-call-dropped',
    `The review asked ${plural(kept.length, 'judgement call')}; only the first ${String(MAX_JUDGEMENT_CALLS)} are shown.`,
  );
  return kept.slice(0, MAX_JUDGEMENT_CALLS);
}

/**
 * One chunk per file in a chapter. The reader keys a file's insights and its
 * file count on the filename, so a chapter the model split across two chunks
 * for one file drew every insight anchored there twice and counted the file
 * twice over.
 */
function mergeChunksByFile(chunks: DiffChunk[], chapterId: string, log: FindingLog): DiffChunk[] {
  const merged = new Map<string, DiffChunk>();
  for (const chunk of chunks) {
    const existing = merged.get(chunk.filename);
    if (!existing) {
      merged.set(chunk.filename, chunk);
      continue;
    }
    log.add(
      'chunks-merged',
      `Chapter ${chapterId} cited ${chunk.filename} in more than one chunk; they were merged into one.`,
      { chapterId, filename: chunk.filename },
    );
    const hunks = new Map(existing.hunks.map((hunk) => [hunk.id, hunk]));
    for (const hunk of chunk.hunks) hunks.set(hunk.id, hunk);
    existing.hunks = [...hunks.values()].toSorted((a, b) => a.fileOrder - b.fileOrder);
  }
  return [...merged.values()];
}

type SanitizedChapter = Rec & { id: string; title: string; diffChunks: DiffChunk[] };

function sanitizeChapter(
  raw: Rec,
  index: number,
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): SanitizedChapter {
  const n = String(index + 1);
  let id: string;
  if (typeof raw['id'] === 'string' && raw['id'].length > 0) {
    id = raw['id'];
  } else {
    id = `chapter-${n}`;
    log.add('chapter-id-synthesised', `Chapter ${n} arrived with no id and was given ${id}.`, {
      chapterId: id,
    });
  }
  let title: string;
  if (typeof raw['title'] === 'string' && raw['title'].length > 0) {
    title = raw['title'];
  } else {
    title = `Chapter ${n}`;
    log.add('chapter-title-synthesised', `Chapter ${id} arrived with no title.`, { chapterId: id });
  }
  const description = sanitizeProse(raw['description'], `Chapter ${id}'s description`, log, {
    chapterId: id,
  });

  const rawChunks: unknown[] = Array.isArray(raw['diffChunks']) ? raw['diffChunks'] : [];
  const diffChunks = mergeChunksByFile(
    rawChunks
      .flatMap((chunk) => {
        if (!isRecord(chunk) || typeof chunk['filename'] !== 'string') {
          log.add(
            'chunk-dropped',
            `Chapter ${id} showed a diff that names no file, so it was dropped.`,
            { chapterId: id },
          );
          return [];
        }
        return [
          {
            filename: chunk['filename'],
            language: typeof chunk['language'] === 'string' ? chunk['language'] : 'plaintext',
            hunks: resolveHunks(chunk, grounding, id, log),
          },
        ];
      })
      // Before the merge, so a chunk whose every hunk id failed to resolve
      // cannot hand its language to the file's surviving chunk.
      .filter((chunk) => chunk.hunks.length > 0),
    id,
    log,
  );

  const diagram = sanitizeDiagram(raw['diagram'], `${id}-diagram`, grounding, log);

  return {
    id,
    title,
    ...(description ? { description } : {}),
    insights: sanitizeInsights(
      raw['insights'],
      new Set(diffChunks.map((c) => c.filename)),
      id,
      log,
    ),
    diffChunks,
    ...(diagram ? { diagram } : {}),
  };
}

/**
 * A chapter with no diffChunks is prose the reader cannot check against any
 * code, whether the model wrote it that way or every hunk id it cited failed
 * to resolve (an invented id, or a filename that didn't match its hunk
 * verbatim). Either way the review is misleading, so the whole answer fails
 * rather than shipping with a hole in it — the caller decides what a failed
 * review means (a job goes to `error`, `er` points at `raw.txt`), but nothing
 * downstream is left to guess why a chapter came back empty.
 *
 * Only enforced when the prompt showed at least one hunk: a change with
 * nothing reviewable (every file skipped) legitimately has no hunk for any
 * chapter to cite, and that is a fact worth showing rather than a failure.
 */
function reportEmptyChapters(
  chapters: SanitizedChapter[],
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): boolean {
  if (!grounding || grounding.shown.hunks.length === 0) return false;
  let any = false;
  for (const chapter of chapters) {
    if (chapter.diffChunks.length > 0) continue;
    log.add(
      'chapter-no-hunks',
      `Chapter "${chapter.title}" (${chapter.id}) cites no hunk that resolved against the diff.`,
      { chapterId: chapter.id },
    );
    any = true;
  }
  return any;
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

const START_TAG = '<narrative_review>';
const END_TAG = '</narrative_review>';

/** Every index at which `tag` occurs, in the order written. */
function tagPositions(text: string, tag: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(tag); at !== -1; at = text.indexOf(tag, at + tag.length)) {
    found.push(at);
  }
  return found;
}

interface Block {
  value: unknown;
  /** Whether escaping stray quotes is what made it parse. */
  repaired: boolean;
}

/** One block's JSON, with one repair attempt. */
function parseBlock(body: string): Block | null {
  try {
    return { value: JSON.parse(body), repaired: false };
  } catch {
    try {
      return { value: JSON.parse(escapeStrayQuotes(body)), repaired: true };
    } catch {
      return null;
    }
  }
}

/**
 * Whether a parsed body is the answer rather than something else that happens
 * to be JSON. Shape only — the fields themselves are checked downstream, and
 * a block that has these two is the block whose defects are worth reporting.
 */
function isAnswer(value: unknown): boolean {
  return (
    isRecord(value) && typeof value['prTitle'] === 'string' && Array.isArray(value['chapters'])
  );
}

/**
 * The block holding the answer, and the block to report against when none
 * does.
 *
 * Neither tag can be taken at face value. A run whose stop was blocked for a
 * defect answers again in the same transcript, so the corrected block is the
 * one at the end and reading from the first would grade the model on the
 * answer it was already told to replace. The model then describes what it did,
 * and the sentence it reaches for names both tags, which leaves a pair of them
 * around a few words of prose. And an answer can quote either tag inside its
 * own JSON — a review of this repository does exactly that — so an opening tag
 * paired with the first closing tag after it can cut the body short at a tag
 * that was never a tag.
 *
 * So nothing is assumed about which tag goes with which: opening tags are
 * tried from last to first, and for each one every closing tag after it from
 * last to first — widest body first, since a tag quoted inside the JSON is
 * always narrower than the real one — and the first body that parses into
 * something shaped like an answer wins. Both counts are tiny; trying every
 * pair costs nothing.
 *
 * `null` when the text holds no opening tag with a closing tag after it. When
 * it holds one but nothing in it is an answer, the result carries the last
 * opening tag paired with the last closing tag after it, so the reason a
 * person is given is drawn from the block the model most likely meant.
 */
function usableBlock(text: string): { block: Block | null } | null {
  const opens = tagPositions(text, START_TAG);
  const closes = tagPositions(text, END_TAG);
  let fallback: { block: Block | null } | null = null;

  for (let i = opens.length - 1; i >= 0; i -= 1) {
    const from = opens[i]! + START_TAG.length;
    const ends = closes.filter((at) => at >= from);
    if (ends.length === 0) continue;
    for (let j = ends.length - 1; j >= 0; j -= 1) {
      const parsed = parseBlock(text.slice(from, ends[j]!).trim());
      if (parsed && isAnswer(parsed.value)) return { block: parsed };
    }
    fallback ??= { block: parseBlock(text.slice(from, ends.at(-1)!).trim()) };
  }
  return fallback;
}

export function parseNarrativeReview(text: string, grounding?: PromptGrounding): ParseResult {
  const log = findingLog();
  const found = usableBlock(text);
  if (!found) {
    log.add('answer-missing-block', 'The answer contains no complete <narrative_review> block.');
    return fail(log);
  }

  const block = found.block;
  if (!block) {
    log.add('answer-unparseable', 'The <narrative_review> block is not valid JSON.');
    return fail(log);
  }
  if (block.repaired) {
    log.add(
      'json-quote-repaired',
      'The block parsed only after a quote left unescaped inside a string was escaped.',
    );
  }
  const parsed = block.value;

  if (!isRecord(parsed) || typeof parsed['prTitle'] !== 'string') {
    log.add('fields-missing', 'The narrative review has no prTitle.');
    return fail(log);
  }
  if (!Array.isArray(parsed['chapters'])) {
    log.add('fields-missing', 'The narrative review has no chapters array.');
    return fail(log);
  }

  const overviewSummary = sanitizeProse(parsed['overviewSummary'], 'The overview summary', log);
  if (!overviewSummary) {
    log.add('fields-missing', 'The narrative review has no overview summary.');
    return fail(log);
  }

  const chapters = parsed['chapters'].map((chapter, index) =>
    sanitizeChapter(isRecord(chapter) ? chapter : {}, index, grounding, log),
  );
  if (reportEmptyChapters(chapters, grounding, log)) return fail(log);

  const riskAssessment = sanitizeRiskAssessment(parsed['riskAssessment'], log);
  const overviewDiagram = sanitizeDiagram(
    parsed['overviewDiagram'],
    'overview-diagram',
    grounding,
    log,
  );
  const judgementCalls = sanitizeJudgementCalls(
    parsed['judgementCalls'],
    new Set(chapters.flatMap((chapter) => chapter.diffChunks.map((chunk) => chunk.filename))),
    grounding,
    log,
  );
  const candidate = {
    prTitle: parsed['prTitle'],
    overviewSummary,
    ...(riskAssessment ? { riskAssessment } : {}),
    ...(overviewDiagram ? { overviewDiagram } : {}),
    chapters,
    ...(judgementCalls.length > 0 ? { judgementCalls } : {}),
  };

  const validated = NarrativeReviewSchema.safeParse(candidate);
  if (!validated.success) {
    log.add('answer-invalid', `The narrative review failed validation: ${validated.error.message}`);
    return fail(log);
  }
  return { ok: true, data: validated.data, findings: log.findings };
}
