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
 *
 * A script's test file is cut by its test runner's blocks as well. A case
 * nearly always runs longer than a part, and cut at the blank lines inside it
 * arrives in pieces, each cited and tiered apart; a `describe(` cut away from
 * what it frames reads as boilerplate. So there a part may begin at any suite,
 * case or hook, never inside a case or hook, and never straight after a
 * suite's opening line, which goes with whatever follows it. A hunk that starts
 * inside a case shows no opening line to go by, and is cut as any other file is.
 */

import { isTestFile } from '../test-file.ts';
import { isScriptFile } from './import-lines.ts';

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
const KINDS: ReadonlySet<string> = new Set<Kind>([' ', '+', '-', '\\']);

interface BodyLine {
  kind: Kind;
  content: string;
}

interface Range {
  start: number;
  end: number;
}

/**
 * `patch`, the diff of `filename`, with every hunk of more than `target`
 * changed lines rewritten as parts of about `target` changed lines each.
 * Everything before the first hunk, and every hunk at or under the target, is
 * returned as it was.
 */
export function splitPatch(patch: string, target: number, filename: string): string {
  if (target <= 0) return patch;
  const testAware = isScriptFile(filename) && isTestFile(filename);
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
    const end = bodyEnd(lines, i, header);
    const body = lines.slice(i + 1, end);
    out.push(...(splitHunk(header, body, target, testAware) ?? lines.slice(i, end)));
    i = end;
  }
  return out.join('\n');
}

/**
 * The index just past a hunk's body, counted off its header's two sides
 * rather than read from line prefixes: with `diff.suppressBlankEmpty`, which
 * `er` runs under when the engineer sets it, git writes a blank context line
 * as an empty line, which no prefix tells from the end of the hunk. A
 * no-newline marker counts toward neither side, so one straight after the
 * last line is taken too.
 */
function bodyEnd(lines: readonly string[], headerAt: number, header: RegExpExecArray): number {
  let original = sideCount(header[2]);
  let modified = sideCount(header[4]);
  let end = headerAt + 1;
  while (original > 0 || modified > 0) {
    const line = lines[end];
    if (line === undefined) throw new Error(`hunk ${lines[headerAt]!} ends before its counts do`);
    const kind = line[0] ?? ' ';
    if (kind === ' ' || kind === '-') original -= 1;
    if (kind === ' ' || kind === '+') modified -= 1;
    if (!KINDS.has(kind) || original < 0 || modified < 0) {
      throw new Error(`hunk ${lines[headerAt]!} does not match its counts at "${line}"`);
    }
    end += 1;
  }
  if (lines[end]?.startsWith('\\')) end += 1;
  return end;
}

/** A header side's line count, which git leaves out when it is one. */
function sideCount(countRaw: string | undefined): number {
  return countRaw === undefined ? 1 : Number.parseInt(countRaw, 10);
}

/** The hunk as several, header and body each; null when it stays whole. */
function splitHunk(
  header: RegExpExecArray,
  raw: string[],
  target: number,
  testAware: boolean,
): string[] | null {
  // An empty line is a blank context line written without its space.
  const body: BodyLine[] = raw.map((line) => ({
    kind: (line[0] ?? ' ') as Kind,
    content: line.slice(1),
  }));
  if (changedIn(body, { start: 0, end: body.length }) <= target) return null;
  const starts = partStarts(body, testAware);
  const whole = { start: 0, end: body.length };
  const parts = pack(body, blocksOf(body, starts, whole, -1, target), target);
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
 * A line that opens a test runner's block, modifiers and all: `it.only(`,
 * `test.each([…])(`, `describe.skip(`.
 */
const TEST_BLOCK_RE =
  /^(describe|context|suite|it|test|bench|beforeAll|beforeEach|afterAll|afterEach)\b[\w.$]*\s*[(`]/;
const SUITES: ReadonlySet<string> = new Set(['describe', 'context', 'suite']);

/** A test runner's block in a hunk, from its opening line to its last, inclusive. */
interface TestBlock {
  open: number;
  close: number;
  suite: boolean;
}

/**
 * The test blocks a hunk shows the opening line of. A block ends at the first
 * line after it indented no deeper than its opening line, which it takes when
 * that line is a closing bracket. Lines only the other side has are passed
 * over, so a removed case is measured on the base and an added one on the head.
 */
function testBlocks(body: readonly BodyLine[]): TestBlock[] {
  const blocks: TestBlock[] = [];
  body.forEach((line, open) => {
    const match = TEST_BLOCK_RE.exec(line.content.trimStart());
    if (!match || !isCode(line)) return;
    const indent = indentOf(line.content);
    const otherSide = line.kind === '-' ? '+' : '-';
    let close = body.length - 1;
    for (let j = open + 1; j < body.length; j += 1) {
      const next = body[j]!;
      if (next.kind === otherSide || !isCode(next) || next.content.trim() === '') continue;
      if (indentOf(next.content) > indent) continue;
      // `it.each` with a table: the line that closes it opens the case's body.
      if (next.content.trimStart().startsWith('`')) continue;
      close = CLOSER_RE.test(next.content.trim()) ? j : j - 1;
      break;
    }
    blocks.push({ open, close, suite: SUITES.has(match[1]!) });
  });
  return blocks;
}

/** A line of the file, as against git's no-newline marker. */
function isCode(line: BodyLine): boolean {
  return line.kind === ' ' || line.kind === '+' || line.kind === '-';
}

/** Where a part may begin, line by line: the note at the top of the file says why. */
function partStarts(body: readonly BodyLine[], testAware: boolean): boolean[] {
  const starts = body.map((_, i) => i > 0 && opensParagraph(body, i));
  if (!testAware) return starts;
  const blocks = testBlocks(body);
  for (const { open } of blocks) {
    if (open > 0 && isCode(body[open - 1]!) && !splitsAnEdit(body, open)) starts[open] = true;
  }
  for (const { open, close } of blocks.filter((block) => !block.suite)) {
    for (let i = open + 1; i <= close; i += 1) starts[i] = false;
  }
  // A suite's opening line goes with whatever follows it, setup or a case.
  for (const { open, close } of blocks.filter((block) => block.suite)) {
    const first = starts.findIndex((start, i) => start && i > open && i <= close);
    if (first !== -1) starts[first] = false;
  }
  return starts;
}

/**
 * `range` cut at its shallowest part starts deeper than `floor`, with any
 * block still over `target` cut again one level further in.
 */
function blocksOf(
  body: readonly BodyLine[],
  partStart: readonly boolean[],
  range: Range,
  floor: number,
  target: number,
): Range[] {
  const starts: number[] = [];
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (partStart[i] && indentOf(body[i]!.content) > floor) starts.push(i);
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
    changedIn(body, block) > target ? blocksOf(body, partStart, block, level, target) : [block],
  );
}

/** How many lines `range` adds or removes that are not blank. */
function textChanged(body: readonly BodyLine[], range: Range): number {
  let count = 0;
  for (let i = range.start; i < range.end; i += 1) {
    const line = body[i]!;
    if ((line.kind === '+' || line.kind === '-') && line.content.trim() !== '') count += 1;
  }
  return count;
}

/**
 * A part changing at most this many lines that are not blank is too slight to
 * stand alone. The typical one is the last paragraph of a function cut at its
 * paragraphs: a `return` and the closing bracket, which on its own reads as
 * nothing but the bracket and gets tiered as if that were all it held.
 */
const SLIGHT_PART_LINES = 3;

/**
 * Adjacent blocks joined while they fit the target, so many small
 * declarations become a few parts rather than one each; a block that alone
 * exceeds it is left alone. A slight part joins the part before it, or the
 * one after when it is first, past the target if need be: on its own it is a
 * hunk with next to nothing in it to read, which still has to be cited and
 * tiered, and is tiered by the little it holds.
 */
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
    const slight = (range: Range) => textChanged(body, range) <= SLIGHT_PART_LINES;
    if (last && (slight(part) || slight(last))) last.end = part.end;
    else parts.push(part);
  }
  return parts;
}
