/**
 * Forgiving partial-JSON extractor for the live `/jobs/:id` preview.
 *
 * The runner streams the executor's raw text into `review_chunks`. The
 * browser concatenates the chunks and re-runs this extractor on every poll.
 * The output drives a checklist: each completed `chapters[i].title` becomes a
 * check; the latest in-progress one shows a typing cursor.
 *
 * Strategy: locate the `"chapters"` array opening, then walk the remaining
 * text tracking nesting depth, taking `"title"` keys that are direct children
 * of a chapter object and stopping at the array's closing `]`. A title whose
 * closing quote has not been emitted yet is the in-progress one. Any scanner
 * failure returns `{ titles: [], inProgressTitle: null }` and the UI falls
 * back to a generic "Streaming…" line.
 *
 * Depth is the whole point. An earlier version searched for every `"title"`
 * key after the array opening, which was correct until insights grew a title
 * of their own — after that a review with 2 chapters and 4 insights reported
 * "6 chapters" and listed insight headlines in the chapter checklist.
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
    return doExtract(fromLastBlock(buffer));
  } catch {
    // The UI never has to handle a throw: any unexpected scanner state
    // collapses to "no titles yet".
    return EMPTY;
  }
}

/**
 * The tail of the buffer from the last `<narrative_review>` opening tag that
 * has chapters under it.
 *
 * A run whose stop was blocked for a defect writes a second block after the
 * first, and scanning from the top would list both sets of chapters — the
 * checklist would grow past the review's real length and repeat titles the
 * model had already withdrawn. But the model also writes about what it just
 * did, and the sentence it reaches for names the tag: the last tag in the
 * buffer is then a remark, the checklist behind it goes blank, and a reader
 * watching a finished review sees it empty out. A tag with no chapters after
 * it is never the answer, so the search carries on back through the earlier
 * ones. Text with no usable tag at all is scanned whole, since there is
 * nothing better to go on.
 */
function fromLastBlock(buffer: string): string {
  const tag = '<narrative_review>';
  let at = buffer.lastIndexOf(tag);
  while (at !== -1) {
    const tail = buffer.slice(at);
    if (findChaptersArrayStart(tail) !== -1) return tail;
    if (at === 0) break;
    at = buffer.lastIndexOf(tag, at - 1);
  }
  return buffer;
}

function doExtract(buffer: string): ChapterTitleSnapshot {
  const chaptersIdx = findChaptersArrayStart(buffer);
  if (chaptersIdx === -1) return EMPTY;

  const titles: string[] = [];
  let inProgressTitle: string | null = null;

  // Nesting relative to the inside of the chapters array: a chapter object
  // puts us at 1, so a `"title"` key is a chapter's own only at depth 1.
  // An insight sits at 3 (chapter object → insights array → insight object).
  let depth = 0;
  let i = chaptersIdx;

  while (i < buffer.length) {
    const ch = buffer[i];

    if (ch === '"') {
      const read = readJsonString(buffer, i);
      // A string still streaming means nothing further can be read; if it was
      // a chapter title we would have taken the branch below instead.
      if (read.kind === 'open') break;

      if (depth === 1 && read.value === 'title') {
        const colon = skipWhitespace(buffer, read.endIdx);
        if (buffer[colon] === ':') {
          const valueStart = skipWhitespace(buffer, colon + 1);
          if (buffer[valueStart] !== '"') break;
          const value = readJsonString(buffer, valueStart);
          if (value.kind === 'open') {
            inProgressTitle = value.value;
            break;
          }
          titles.push(value.value);
          i = value.endIdx;
          continue;
        }
      }

      // Any other string — a key we do not want, or a value that might itself
      // contain braces — is stepped over whole, so its contents cannot move
      // the depth counter.
      i = read.endIdx;
      continue;
    }

    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ']') {
      depth -= 1;
      // The `]` that closes the chapters array itself.
      if (depth < 0) break;
    }
    i += 1;
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
