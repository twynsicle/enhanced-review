/**
 * Forgiving partial-JSON extractor for the live `/jobs/:id` preview.
 *
 * The runner streams the executor's raw text into `review_chunks`. The
 * browser concatenates the chunks and re-runs this extractor on every poll.
 * The output drives a checklist: each completed `chapters[i].title` becomes a
 * check; the latest in-progress one shows a typing cursor.
 *
 * Strategy: locate the `"chapters"` array opening, then walk the remaining
 * text looking for `"title"` keys. A title whose closing quote has not been
 * emitted yet is the in-progress one. Any scanner failure returns
 * `{ titles: [], inProgressTitle: null }` and the UI falls back to a generic
 * "Streaming…" line.
 *
 * Deliberately not a real JSON parser: the model's output is wrapped in
 * `<narrative_review>` tags but the surrounding free text can be anything, and
 * a tolerant scanner is more robust than a strict streaming parser for the
 * tiny signal we need.
 */
export interface ChapterTitleSnapshot {
  /** Chapter titles whose closing quote has been emitted, in document order. */
  titles: string[];
  /** The last in-flight title (no closing quote yet), or null. */
  inProgressTitle: string | null;
}

const EMPTY: ChapterTitleSnapshot = { titles: [], inProgressTitle: null };

export function extractChapterTitles(buffer: string): ChapterTitleSnapshot {
  if (buffer.length === 0) return EMPTY;
  try {
    return doExtract(buffer);
  } catch {
    // The UI never has to handle a throw: any unexpected scanner state
    // collapses to "no titles yet".
    return EMPTY;
  }
}

function doExtract(buffer: string): ChapterTitleSnapshot {
  const chaptersIdx = findChaptersArrayStart(buffer);
  if (chaptersIdx === -1) return EMPTY;

  const titles: string[] = [];
  let inProgressTitle: string | null = null;

  let i = chaptersIdx;
  while (i < buffer.length) {
    const titleAt = findTitleKey(buffer, i);
    if (titleAt === -1) break;

    const valueStart = findStringValueStart(buffer, titleAt);
    if (valueStart === -1) break;

    const read = readJsonString(buffer, valueStart);
    if (read.kind === 'closed') {
      titles.push(read.value);
      i = read.endIdx;
    } else {
      inProgressTitle = read.value;
      break;
    }
  }

  return { titles, inProgressTitle };
}

/** Index just after the `[` of `"chapters": [`, or -1. */
function findChaptersArrayStart(buffer: string): number {
  const key = '"chapters"';
  let from = 0;
  while (from < buffer.length) {
    const keyAt = buffer.indexOf(key, from);
    if (keyAt === -1) return -1;
    let j = skipWhitespace(buffer, keyAt + key.length);
    if (buffer[j] !== ':') {
      from = keyAt + 1;
      continue;
    }
    j = skipWhitespace(buffer, j + 1);
    if (buffer[j] !== '[') {
      from = keyAt + 1;
      continue;
    }
    return j + 1;
  }
  return -1;
}

/** Index of the next `"title"` used as a key (followed by `:`), or -1. */
function findTitleKey(buffer: string, from: number): number {
  const key = '"title"';
  let j = from;
  while (j < buffer.length) {
    const at = buffer.indexOf(key, j);
    if (at === -1) return -1;
    const k = skipWhitespace(buffer, at + key.length);
    if (buffer[k] === ':') return at;
    j = at + 1;
  }
  return -1;
}

/** Index of the opening `"` of the string value after a key, or -1 if not streamed yet. */
function findStringValueStart(buffer: string, keyStart: number): number {
  let j = keyStart;
  while (j < buffer.length && buffer[j] !== ':') j += 1;
  if (j >= buffer.length) return -1;
  j = skipWhitespace(buffer, j + 1);
  if (j >= buffer.length || buffer[j] !== '"') return -1;
  return j;
}

type ReadStringResult =
  | { kind: 'closed'; value: string; /** Index just after the closing `"`. */ endIdx: number }
  | { kind: 'open'; value: string };

/**
 * Read a JSON string whose opening `"` is at `openIdx`. `closed` when the
 * closing quote has arrived, else `open` with the text streamed so far.
 * Honours the simple JSON escapes and `\uXXXX`.
 */
function readJsonString(buffer: string, openIdx: number): ReadStringResult {
  let j = openIdx + 1;
  let out = '';
  while (j < buffer.length) {
    const ch = buffer[j];
    if (ch === '"') return { kind: 'closed', value: out, endIdx: j + 1 };
    if (ch !== '\\') {
      out += ch;
      j += 1;
      continue;
    }
    const next = buffer[j + 1];
    if (next === undefined) return { kind: 'open', value: out };
    switch (next) {
      case '"':
      case '\\':
      case '/':
        out += next;
        j += 2;
        break;
      case 'n':
        out += '\n';
        j += 2;
        break;
      case 'r':
        out += '\r';
        j += 2;
        break;
      case 't':
        out += '\t';
        j += 2;
        break;
      case 'u': {
        if (j + 6 > buffer.length) return { kind: 'open', value: out };
        const hex = buffer.slice(j + 2, j + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { kind: 'open', value: out };
        out += String.fromCharCode(Number.parseInt(hex, 16));
        j += 6;
        break;
      }
      default:
        // Unknown escape: keep the character, drop the backslash.
        out += next;
        j += 2;
    }
  }
  return { kind: 'open', value: out };
}

function skipWhitespace(buffer: string, from: number): number {
  let j = from;
  while (j < buffer.length) {
    const ch = buffer[j];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') j += 1;
    else break;
  }
  return j;
}
