import { plural } from '../plural.ts';
import { asRead, judgementCallOwner, mergeCitations } from '../coverage.ts';
import {
  excerptsDropped,
  findingLog,
  type ExcerptDrop,
  type Finding,
  type FindingLog,
} from '../findings.ts';
import {
  HunkTierSchema,
  InsightTypeSchema,
  MAX_CONTEXT_EXCERPTS,
  MAX_EXCERPT_LINES,
  MAX_JUDGEMENT_CALLS,
  NarrativeReviewSchema,
  ReviewRiskFactorImpactSchema,
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type CitedHunk,
  type ContextExcerpt,
  type DiffChunk,
  type Insight,
  type JudgementCall,
  type NarrativeReview,
  type Prose,
  type ReviewRiskAssessment,
  type ReviewRiskFactorImpact,
  type ReviewRiskScore,
} from '../narrative.ts';
import { toResolvedHunk, type DiffHunk, type PromptGrounding } from './diff-hunk-catalog.ts';
import { sanitizeDiagram } from './parse-diagram.ts';

/**
 * Turns the model's `<narrative_review>` block into a `NarrativeReview`.
 * Lenient on purpose: missing ids/titles are synthesised, a repeated id is
 * replaced (the first chapter keeps it), unknown insight
 * types fall back to `context`, an out-of-range risk score drops the whole
 * assessment, and hunk ids are resolved against what the prompt showed
 * (unknown or wrong-file ids are dropped). A cited hunk with no usable tier is
 * read as `read`, leaning toward more of the reader's attention, never less;
 * one proven whitespace-only is `skim` whatever it says. A skim reason is kept
 * on a skim hunk only. A reading plan keeps only
 * real chapters, its standard read widened to hold its brief, and is dropped
 * when no brief chapter is left. An excerpt of unchanged code that breaks a
 * rule is dropped, never trimmed to fit. Diagrams go through `parse-diagram.ts`,
 * which validates each one on its own so a malformed picture cannot take the
 * review down with it. The result is validated against
 * `NarrativeReviewSchema`, so whatever lands in `review.json` parses back
 * when the report reads it.
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

/**
 * The hunks whose tier had to be repaired, across the whole answer. A model
 * that forgets tiers forgets them everywhere, so these are reported once per
 * review with a count rather than once per hunk.
 */
interface TierRepairs {
  /** No tier, or one that is not read or skim: read as `read`. */
  tierMissing: Set<string>;
  /** Tiered `read` but proven whitespace only: skimmed. */
  tierLowered: Set<string>;
}

/**
 * One entry of a chunk's `hunks`. A bare string is an id with no tier: the
 * shape the model falls back to when it forgets the object, which is leniency
 * toward the model's answer and not toward any stored shape.
 */
function readCitation(raw: unknown): { id: unknown; tier: unknown; skimReason: unknown } {
  if (isRecord(raw)) return { id: raw['id'], tier: raw['tier'], skimReason: raw['skimReason'] };
  return { id: raw, tier: undefined, skimReason: undefined };
}

/**
 * A whitespace-only hunk is skim whatever the model says, so a missing tier
 * there is no loss. A reason that is not a string, or is blank, is no reason:
 * the reader then labels the lines "Skim" alone.
 */
function citedHunk(
  hunk: DiffHunk,
  { tier: rawTier, skimReason: rawReason }: { tier: unknown; skimReason: unknown },
  repairs: TierRepairs,
): CitedHunk {
  const parsed = HunkTierSchema.safeParse(rawTier);
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  const skim = (): CitedHunk => ({
    ...toResolvedHunk(hunk),
    tier: 'skim',
    ...(reason ? { skimReason: reason } : {}),
  });
  if (hunk.whitespaceOnly) {
    if (parsed.success && parsed.data === 'read') repairs.tierLowered.add(hunk.id);
    return skim();
  }
  if (!parsed.success) repairs.tierMissing.add(hunk.id);
  return parsed.success && parsed.data === 'skim'
    ? skim()
    : { ...toResolvedHunk(hunk), tier: 'read' };
}

function resolveHunks(
  chunk: Rec,
  grounding: PromptGrounding | undefined,
  chapterId: string,
  log: FindingLog,
  repairs: TierRepairs,
): CitedHunk[] {
  // Nothing to resolve against: no prompt showed this answer any hunks, so a
  // chunk citing none of them is not a chunk that lost anything.
  if (!grounding) return [];
  const filename = typeof chunk['filename'] === 'string' ? chunk['filename'] : '';
  const rawHunks: unknown[] = Array.isArray(chunk['hunks']) ? chunk['hunks'] : [];
  if (rawHunks.length === 0) {
    // Recorded here rather than where the empty chunk is finally dropped:
    // this is the last place that knows which file's diff went with it.
    log.add(
      'chunk-dropped',
      `Chapter ${chapterId} showed ${filename || 'a file it did not name'} with no hunk to resolve, so that diff was dropped.`,
      { chapterId, ...(filename ? { filename } : {}) },
    );
    return [];
  }
  const where = { chapterId, ...(filename ? { filename } : {}) };
  const deduped = new Map<string, CitedHunk>();
  let repeated = 0;
  for (const raw of rawHunks) {
    const citation = readCitation(raw);
    const id = citation.id;
    const hunk = typeof id === 'string' ? grounding.shown.byId[id] : undefined;
    if (!hunk || hunk.filename !== filename) {
      log.add(
        'hunk-id-dropped',
        `Chapter ${chapterId} cited ${typeof id === 'string' ? id : 'a hunk id that is not a string'} for ${filename || 'a chunk with no filename'}, which resolved against nothing.`,
        where,
      );
      continue;
    }
    const cited = citedHunk(hunk, citation, repairs);
    const earlier = deduped.get(hunk.id);
    if (earlier) repeated += 1;
    deduped.set(hunk.id, earlier ? mergeCitations(earlier, cited) : cited);
  }
  if (repeated > 0) {
    log.add(
      'chunks-merged',
      `Chapter ${chapterId} cited ${plural(repeated, 'hunk')} twice over in its ${filename} chunk; the repeats were merged.`,
      where,
    );
  }
  return [...deduped.values()].toSorted((a, b) => a.fileOrder - b.fileOrder);
}

/** The one finding each kind of tier repair earns across the whole answer. */
function reportTierRepairs({ tierMissing, tierLowered }: TierRepairs, log: FindingLog): void {
  if (tierMissing.size > 0) {
    log.add(
      'hunk-tier-missing',
      `${plural(tierMissing.size, 'cited hunk')} came with no tier of read or skim, so ${tierMissing.size > 1 ? 'they are' : 'it is'} marked to be read.`,
      { hunkIds: [...tierMissing] },
    );
  }
  if (tierLowered.size > 0) {
    log.add(
      'hunk-tier-lowered',
      `${plural(tierLowered.size, 'cited hunk')} tiered to be read ${tierLowered.size > 1 ? 'change' : 'changes'} only whitespace, so ${tierLowered.size > 1 ? 'they are' : 'it is'} marked to be skimmed.`,
      { hunkIds: [...tierLowered] },
    );
  }
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
 * The check is against the diff cards that exist on the page rather than
 * against the change: a question anchored to a file no chapter shows has no
 * card to sit beside, and it is dropped rather than hoisted somewhere the
 * reader meets it before any code. That is the opposite call to the one an
 * insight gets — an insight that loses its anchor still says something on its
 * own, while a question about lines the reader cannot see is a question about
 * nothing.
 *
 * A call is drawn on one card, its `judgementCallOwner`'s, so its hunk ids are
 * narrowed to the ones that card shows: a hunk of the same file that another
 * chapter shows is somewhere the reader will not find the question.
 *
 * The cap is applied here and not left to the schema, because the schema can
 * only refuse the whole review, and a model that asks five good questions has
 * not produced an invalid answer.
 */
function sanitizeJudgementCalls(
  raw: unknown,
  chapters: readonly SanitizedChapter[],
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): JudgementCall[] {
  const cited = new Set(
    chapters.flatMap((chapter) => chapter.diffChunks.map((chunk) => chunk.filename)),
  );
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
    const resolved = resolveJudgementHunks(call['hunkIds'], filename, title, grounding, log);
    if (resolved.length === 0) {
      log.add(
        'judgement-call-dropped',
        `The judgement call "${title}" cites no hunk of ${filename} that resolved against the diff.`,
        { filename },
      );
      return [];
    }
    const owner = judgementCallOwner(
      { filename, hunkIds: resolved.map((hunk) => hunk.id) },
      chapters,
    );
    if (!owner) {
      log.add(
        'judgement-call-dropped',
        `The judgement call "${title}" cites hunks of ${filename} that no chapter shows, so there is nowhere to ask it.`,
        { filename },
      );
      return [];
    }
    const shown = new Set(
      owner.diffChunks
        .filter((chunk) => chunk.filename === filename)
        .flatMap((chunk) => chunk.hunks.map((hunk) => hunk.id)),
    );
    const [first, ...rest] = resolved.filter((hunk) => {
      if (shown.has(hunk.id)) return true;
      log.add(
        'judgement-hunk-id-dropped',
        `The judgement call "${title}" cited ${hunk.id}, which chapter ${owner.id} does not show beside it.`,
        { filename, chapterId: owner.id },
      );
      return false;
    });
    // `owner` was chosen for showing one of these, so at least one survives.
    if (first === undefined) return [];
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
 * The chapters with every hunk a judgement call asks about raised to `read` on
 * the card that draws the call. A question sitting on a skim hunk would be
 * asked about lines the reader was told to pass over, so the question wins
 * over the tier; one note per review records how often it had to.
 */
function raiseJudgedHunks(
  calls: readonly JudgementCall[],
  chapters: readonly SanitizedChapter[],
  log: FindingLog,
): SanitizedChapter[] {
  const judged = new Map<SanitizedChapter, Map<string, Set<string>>>();
  for (const call of calls) {
    const owner = judgementCallOwner(call, chapters);
    if (!owner) continue;
    const byFile = judged.get(owner) ?? new Map<string, Set<string>>();
    const ids = byFile.get(call.filename) ?? new Set<string>();
    for (const id of call.hunkIds) ids.add(id);
    byFile.set(call.filename, ids);
    judged.set(owner, byFile);
  }

  const raised: string[] = [];
  const result = chapters.map((chapter) => {
    const byFile = judged.get(chapter);
    if (!byFile) return chapter;
    const diffChunks = chapter.diffChunks.map((chunk) => {
      const ids = byFile.get(chunk.filename);
      if (!ids) return chunk;
      const hunks = chunk.hunks.map((hunk): CitedHunk => {
        if (!ids.has(hunk.id) || hunk.tier === 'read') return hunk;
        raised.push(hunk.id);
        return asRead(hunk);
      });
      return { ...chunk, hunks };
    });
    return { ...chapter, diffChunks };
  });

  if (raised.length > 0) {
    log.add(
      'hunk-tier-raised',
      `${plural(raised.length, 'cited hunk')} a judgement call asks about ${raised.length > 1 ? 'were' : 'was'} tiered to be skimmed, so ${raised.length > 1 ? 'they are' : 'it is'} marked to be read.`,
      { hunkIds: raised },
    );
  }
  return result;
}

function isLineNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * A path as git names a file from the repository root. Anything else — an
 * absolute path, a `..`, a Windows separator — is not a file this review can
 * show, and handed to git as a pathspec it would fail the parse stage rather
 * than the one excerpt.
 */
function isRepositoryPath(filename: string): boolean {
  return (
    !filename.includes(BACKSLASH) &&
    !/^[A-Za-z]:/.test(filename) &&
    filename.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

/** An excerpt as a finding names it: its path and span, as far as it gave them. */
function describeExcerpt(raw: Rec): string {
  const filename =
    typeof raw['filename'] === 'string' && raw['filename'] !== '' ? raw['filename'] : 'an excerpt';
  const start = raw['startLine'];
  const end = raw['endLine'];
  return typeof start === 'number' && typeof end === 'number'
    ? `${filename} L${String(start)}–${String(end)}`
    : filename;
}

/**
 * The chapter's excerpts of unchanged code, held to what can be judged
 * without git: a file, a forward span of at most MAX_EXCERPT_LINES, a reason,
 * and never a path the change touches, since those lines have a diff of their
 * own. The first MAX_CONTEXT_EXCERPTS that pass are kept. Whether the file and
 * span exist at the head commit is the parse stage's to check.
 */
function sanitizeContextExcerpts(
  raw: unknown,
  chapterId: string,
  grounding: PromptGrounding | undefined,
  drops: ExcerptDrop[],
): ContextExcerpt[] {
  if (!arrived(raw)) return [];
  if (!Array.isArray(raw)) {
    drops.push({ chapterId, excerpt: 'its excerpts', why: 'not a list' });
    return [];
  }
  const kept: ContextExcerpt[] = [];
  for (const item of raw as unknown[]) {
    const drop = (excerpt: string, why: string): void => {
      drops.push({ chapterId, excerpt, why });
    };
    if (!isRecord(item) || Array.isArray(item)) {
      drop('an excerpt', 'not an object');
      continue;
    }
    const described = describeExcerpt(item);
    const { filename, startLine, endLine } = item;
    const reason = typeof item['reason'] === 'string' ? item['reason'].trim() : '';
    if (typeof filename !== 'string' || filename === '') drop(described, 'it names no file');
    else if (!isRepositoryPath(filename)) drop(described, 'not a path from the repository root');
    else if (!isLineNumber(startLine) || !isLineNumber(endLine)) {
      drop(described, 'its lines are not whole numbers from 1');
    } else if (startLine > endLine) drop(described, 'its span runs backwards');
    else if (endLine - startLine + 1 > MAX_EXCERPT_LINES) {
      drop(
        described,
        `${String(endLine - startLine + 1)} lines, over the ${String(MAX_EXCERPT_LINES)}-line limit`,
      );
    } else if (reason === '') drop(described, 'it gives no reason');
    else if (grounding?.changed.has(filename)) drop(described, 'a file this change touches');
    else if (kept.length >= MAX_CONTEXT_EXCERPTS) {
      drop(described, `past the ${String(MAX_CONTEXT_EXCERPTS)} a chapter may show`);
    } else kept.push({ filename, startLine, endLine, reason });
  }
  return kept;
}

/** Ids, quoted and listed once each, for a finding's sentence. */
function listed(ids: Iterable<string>): string {
  return [...new Set(ids)].map((id) => `"${id}"`).join(', ');
}

/**
 * The model's reading plan, held to the chapters that survived parsing.
 *
 * Each list keeps the ids of real chapters, once each, in chapter order: the
 * order of the chapters is the order they are read in, so the order a list
 * arrived in carries nothing a reader could use. `standard` is widened to
 * hold all of `brief`, since a longer read that skips what the shorter one
 * calls essential cannot be what the model meant.
 *
 * A plan with no brief left is dropped rather than guessed at. Picking the
 * core chapters is the judgement the plan exists for, and a guess would look
 * exactly like one. A review with no chapters has nothing to plan, so silence
 * there loses nothing.
 */
function sanitizeReadingPlan(
  raw: unknown,
  chapters: readonly SanitizedChapter[],
  log: FindingLog,
): { brief: string[]; standard: string[] } | undefined {
  if (chapters.length === 0) return undefined;
  const drop = (message: string): undefined => {
    log.add('reading-plan-dropped', message);
    return undefined;
  };
  if (!arrived(raw)) return drop('The answer gave no reading plan, so the review has none.');
  if (!isRecord(raw) || Array.isArray(raw)) {
    return drop('The reading plan was not an object, so the review has none.');
  }

  const position = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const inChapterOrder = (ids: Iterable<string>): string[] =>
    [...ids].toSorted((a, b) => position.get(a)! - position.get(b)!);
  const unknown: string[] = [];
  const repeated: string[] = [];
  const chaptersIn = (list: unknown): string[] => {
    const items: unknown[] = Array.isArray(list) ? list : [];
    const kept = new Set<string>();
    for (const item of items) {
      const id = typeof item === 'string' ? item : String(JSON.stringify(item));
      if (!position.has(id)) unknown.push(id);
      else if (kept.has(id)) repeated.push(id);
      else kept.add(id);
    }
    return inChapterOrder(kept);
  };
  const brief = chaptersIn(raw['brief']);
  const asked = chaptersIn(raw['standard']);

  if (unknown.length > 0 || repeated.length > 0) {
    const parts = [
      ...(unknown.length > 0 ? [`${listed(unknown)}, which no chapter is called`] : []),
      ...(repeated.length > 0 ? [`${listed(repeated)} more than once in one list`] : []),
    ];
    log.add(
      'reading-plan-id-dropped',
      `The reading plan named ${parts.join(', and ')}; those entries were dropped.`,
    );
  }
  if (brief.length === 0) {
    return drop('The reading plan’s brief named no chapter of this review, so it was dropped.');
  }

  const missing = brief.filter((id) => !asked.includes(id));
  if (missing.length > 0) {
    log.add(
      'reading-plan-widened',
      `The reading plan’s standard read left out ${listed(missing)} from its brief, so ${missing.length > 1 ? 'they were' : 'it was'} added to it.`,
    );
  }
  return { brief, standard: inChapterOrder(new Set([...brief, ...asked])) };
}

/**
 * One chunk per file in a chapter. The reader keys a file's insights and its
 * file count on the filename, so a chapter the model split across two chunks
 * for one file drew every insight anchored there twice and counted the file
 * twice over. A hunk both chunks cite keeps its more attentive tier.
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
    for (const hunk of chunk.hunks) {
      const earlier = hunks.get(hunk.id);
      hunks.set(hunk.id, earlier ? mergeCitations(earlier, hunk) : hunk);
    }
    existing.hunks = [...hunks.values()].toSorted((a, b) => a.fileOrder - b.fileOrder);
  }
  return [...merged.values()];
}

type SanitizedChapter = Rec & { id: string; title: string; diffChunks: DiffChunk[] };

/** `chapter-<n>`, or the first `chapter-<n>-<k>` free when a model id already took it. */
function freshChapterId(n: string, taken: ReadonlySet<string>): string {
  let id = `chapter-${n}`;
  for (let k = 2; taken.has(id); k += 1) id = `chapter-${n}-${String(k)}`;
  return id;
}

/**
 * Each chapter's id, unique, since the reading plan, the sidebar, reading
 * progress and the footer's Next all key on it and a repeat would make two
 * chapters one. Every id the model gave is reserved before any is made up,
 * so a synthesised `chapter-<n>` never takes one a later chapter named; only
 * a real repeat, of an earlier chapter's id or a reader section's, is
 * replaced, the first holder keeping it.
 */
function chapterIds(raw: readonly unknown[], log: FindingLog): string[] {
  const given = raw.map((chapter) =>
    isRecord(chapter) && typeof chapter['id'] === 'string' && chapter['id'].length > 0
      ? chapter['id']
      : null,
  );
  const taken = new Set([SUMMARY_SECTION_ID, RISK_SECTION_ID]);
  const kept = given.map((id) => {
    if (id === null || taken.has(id)) return null;
    taken.add(id);
    return id;
  });
  return kept.map((id, index) => {
    if (id !== null) return id;
    const n = String(index + 1);
    const fresh = freshChapterId(n, taken);
    taken.add(fresh);
    const repeated = given[index] ?? null;
    if (repeated === null) {
      log.add('chapter-id-synthesised', `Chapter ${n} arrived with no id and was given ${fresh}.`, {
        chapterId: fresh,
      });
    } else {
      log.add(
        'chapter-id-duplicate',
        `Chapter ${n}'s id ${repeated} was already taken, so it was given ${fresh}; the reading plan's ${repeated} means the first.`,
        { chapterId: fresh },
      );
    }
    return fresh;
  });
}

function sanitizeChapter(
  raw: Rec,
  index: number,
  id: string,
  grounding: PromptGrounding | undefined,
  log: FindingLog,
  repairs: TierRepairs,
  excerptDrops: ExcerptDrop[],
): SanitizedChapter {
  const n = String(index + 1);
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
            hunks: resolveHunks(chunk, grounding, id, log, repairs),
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
  const contextExcerpts = sanitizeContextExcerpts(
    raw['contextExcerpts'],
    id,
    grounding,
    excerptDrops,
  );

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
    ...(contextExcerpts.length > 0 ? { contextExcerpts } : {}),
    ...(diagram ? { diagram } : {}),
  };
}

/**
 * A chapter with no diffChunks is prose the reader cannot check against any
 * code, whether the model wrote it that way or every hunk id it cited failed
 * to resolve (an invented id, or a filename that didn't match its hunk
 * verbatim). Either way the review is misleading, so the whole answer fails
 * rather than shipping with a hole in it — the caller decides what a failed
 * review means (`er` points at `raw.txt`), but nothing
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

  const repairs: TierRepairs = { tierMissing: new Set(), tierLowered: new Set() };
  const excerptDrops: ExcerptDrop[] = [];
  const ids = chapterIds(parsed['chapters'], log);
  const chapters = parsed['chapters'].map((chapter, index) =>
    sanitizeChapter(
      isRecord(chapter) ? chapter : {},
      index,
      ids[index]!,
      grounding,
      log,
      repairs,
      excerptDrops,
    ),
  );
  reportTierRepairs(repairs, log);
  if (excerptDrops.length > 0) {
    const dropped = excerptsDropped(excerptDrops);
    log.add(dropped.code, dropped.message);
  }
  if (reportEmptyChapters(chapters, grounding, log)) return fail(log);

  const riskAssessment = sanitizeRiskAssessment(parsed['riskAssessment'], log);
  const overviewDiagram = sanitizeDiagram(
    parsed['overviewDiagram'],
    'overview-diagram',
    grounding,
    log,
  );
  const judgementCalls = sanitizeJudgementCalls(parsed['judgementCalls'], chapters, grounding, log);
  const readingPlan = sanitizeReadingPlan(parsed['readingPlan'], chapters, log);
  const candidate = {
    prTitle: parsed['prTitle'],
    overviewSummary,
    ...(riskAssessment ? { riskAssessment } : {}),
    ...(overviewDiagram ? { overviewDiagram } : {}),
    chapters: raiseJudgedHunks(judgementCalls, chapters, log),
    ...(readingPlan ? { readingPlan } : {}),
    ...(judgementCalls.length > 0 ? { judgementCalls } : {}),
  };

  const validated = NarrativeReviewSchema.safeParse(candidate);
  if (!validated.success) {
    log.add('answer-invalid', `The narrative review failed validation: ${validated.error.message}`);
    return fail(log);
  }
  return { ok: true, data: validated.data, findings: log.findings };
}
