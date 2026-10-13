/**
 * Splits a large hunk of one file's unified diff into several smaller hunks,
 * each a real hunk with its own header, so a long new file or a long rewrite
 * can be cited a part at a time rather than whole.
 *
 * Git's hunks are the only unit a chapter can cite, and git makes them by
 * distance between changes, not by meaning: a new file is one hunk however
 * many stories it holds. A chapter that wants one function of it has to take
 * all of it, and a review whose chapters each want a different part shows the
 * same file twice.
 *
 * Boundaries come from the text alone, not a parser, so any language gets
 * them: a part starts at a paragraph — a line after a blank one — at the
 * shallowest indentation among the paragraphs in range. That is between
 * declarations at the top of a file, between members inside a class, and,
 * one level deeper still, between a function's setup and its body. Doc
 * comments and decorators stay with what follows them because no blank line
 * separates the two.
 */

const HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Hunks with more changed lines than this are split; `0` keeps git's hunks. */
export const DEFAULT_SPLIT_LINES = 10;

const PART_RE = /^@@ [^@]* @@ \(part (\d+) of (\d+)\)/;

/** Which part of a split hunk a header belongs to, or null for a hunk git wrote. */
export function splitPart(header: string): { part: number; of: number } | null {
  const match = PART_RE.exec(header);
  return match ? { part: Number(match[1]), of: Number(match[2]) } : null;
}

type Kind = ' ' | '+' | '-' | '\\';

interface BodyLine {
  kind: Kind;
  content: string;
}

interface Range {
  start: number;
  end: number;
}

/**
 * `patch` with every hunk of more than `target` changed lines rewritten as
 * parts of about `target` changed lines each. Everything before the first
 * hunk, and every hunk at or under the target, is returned as it was.
 */
export function splitPatch(patch: string, target: number): string {
  if (target <= 0) return patch;
  const lines = patch.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = HEADER_RE.exec(lines[i]!);
    if (!header) {
      out.push(lines[i]!);
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < lines.length && isBodyLine(lines[end]!)) end += 1;
    out.push(...(splitHunk(header, lines.slice(i + 1, end), target) ?? lines.slice(i, end)));
    i = end;
  }
  return out.join('\n');
}

/** A hunk body line: context, addition, deletion, or git's no-newline marker. */
function isBodyLine(line: string): boolean {
  return (
    line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\')
  );
}

/** The hunk as several, header and body each; null when it stays whole. */
function splitHunk(header: RegExpExecArray, raw: string[], target: number): string[] | null {
  const body: BodyLine[] = raw.map((line) => ({
    kind: line[0] as Kind,
    content: line.slice(1),
  }));
  if (changedIn(body, { start: 0, end: body.length }) <= target) return null;
  const parts = pack(body, blocksOf(body, { start: 0, end: body.length }, -1, target), target);
  if (parts.length < 2) return null;

  let original = cursor(header[1]!, header[2]);
  let modified = cursor(header[3]!, header[4]);
  const trailing = header[5] ?? '';
  const out: string[] = [];
  parts.forEach((part, index) => {
    const lines = body.slice(part.start, part.end);
    const originalCount = lines.filter((l) => l.kind === ' ' || l.kind === '-').length;
    const modifiedCount = lines.filter((l) => l.kind === ' ' || l.kind === '+').length;
    const label = ` (part ${String(index + 1)} of ${String(parts.length)})`;
    out.push(
      `@@ -${span(original, originalCount)} +${span(modified, modifiedCount)} @@${label}${index === 0 ? trailing : ''}`,
      ...raw.slice(part.start, part.end),
    );
    original += originalCount;
    modified += modifiedCount;
  });
  return out;
}

/**
 * The first line of a side the hunk has not yet consumed. A side with no
 * lines is written as the line it sits after, so its next line is one on.
 */
function cursor(startRaw: string, countRaw: string | undefined): number {
  const start = Number.parseInt(startRaw, 10);
  return countRaw !== undefined && Number.parseInt(countRaw, 10) === 0 ? start + 1 : start;
}

/** A header side, `start,count`, with an empty side written as git does: the line it follows. */
function span(next: number, count: number): string {
  return `${String(count === 0 ? next - 1 : next)},${String(count)}`;
}

function changedIn(body: readonly BodyLine[], range: Range): number {
  let count = 0;
  for (let i = range.start; i < range.end; i += 1) {
    const kind = body[i]!.kind;
    if (kind === '+' || kind === '-') count += 1;
  }
  return count;
}

const CLOSER_RE = /^(?:[}\])]|end\b)/;

/**
 * Whether a part may begin at `i`: the line opens a paragraph and does not
 * close one, and the cut does not fall inside an edit.
 */
function opensParagraph(body: readonly BodyLine[], i: number): boolean {
  const line = body[i]!;
  const previous = body[i - 1]!;
  if (line.kind === '\\' || previous.kind === '\\') return false;
  if (line.content.trim() === '' || previous.content.trim() !== '') return false;
  if (CLOSER_RE.test(line.content.trim())) return false;
  return !splitsAnEdit(body, i);
}

/**
 * Whether a cut before `i` lands inside a run of changed lines that both
 * removes and adds. Git writes such a run as all its deletions and then all
 * its additions, so any cut inside it parts some line's before from its after.
 * A run that only adds, or only removes, may be cut anywhere.
 */
function splitsAnEdit(body: readonly BodyLine[], i: number): boolean {
  if (body[i - 1]!.kind === ' ' || body[i]!.kind === ' ') return false;
  let removes = false;
  let adds = false;
  const note = (kind: Kind) => {
    if (kind === '-') removes = true;
    if (kind === '+') adds = true;
  };
  for (let j = i - 1; j >= 0 && body[j]!.kind !== ' '; j -= 1) note(body[j]!.kind);
  for (let j = i; j < body.length && body[j]!.kind !== ' '; j += 1) note(body[j]!.kind);
  return removes && adds;
}

function indentOf(content: string): number {
  return content.length - content.trimStart().length;
}

/**
 * `range` cut at its shallowest paragraph starts deeper than `floor`, with any
 * block still over `target` cut again one level further in.
 */
function blocksOf(body: readonly BodyLine[], range: Range, floor: number, target: number): Range[] {
  const starts: number[] = [];
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (opensParagraph(body, i) && indentOf(body[i]!.content) > floor) starts.push(i);
  }
  if (starts.length === 0) return [range];
  const level = Math.min(...starts.map((i) => indentOf(body[i]!.content)));
  const cuts = starts.filter((i) => indentOf(body[i]!.content) === level);

  const blocks: Range[] = [];
  let from = range.start;
  for (const cut of [...cuts, range.end]) {
    blocks.push({ start: from, end: cut });
    from = cut;
  }
  return blocks.flatMap((block) =>
    changedIn(body, block) > target ? blocksOf(body, block, level, target) : [block],
  );
}

/**
 * Adjacent blocks joined while they fit the target, so many small
 * declarations become a few parts rather than one each; a block that alone
 * exceeds it is left alone. A part that changes nothing but blank lines joins
 * the part before it, or the one after when it is first: on its own it is a
 * hunk with nothing in it to read, which still has to be cited and tiered.
 */
function changesText(body: readonly BodyLine[], range: Range): boolean {
  for (let i = range.start; i < range.end; i += 1) {
    const line = body[i]!;
    if ((line.kind === '+' || line.kind === '-') && line.content.trim() !== '') return true;
  }
  return false;
}

function pack(body: readonly BodyLine[], blocks: readonly Range[], target: number): Range[] {
  const packed: Range[] = [];
  for (const block of blocks) {
    const last = packed.at(-1);
    if (last && changedIn(body, last) + changedIn(body, block) <= target) last.end = block.end;
    else packed.push({ ...block });
  }
  const parts: Range[] = [];
  for (const part of packed) {
    const last = parts.at(-1);
    if (last && (!changesText(body, part) || !changesText(body, last))) last.end = part.end;
    else parts.push(part);
  }
  return parts;
}
