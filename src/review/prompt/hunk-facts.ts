import { detectLanguage } from '../language-map.ts';
import type { HunkFacts } from '../narrative.ts';

/**
 * What the patch proves about a hunk on its own, with no model and no
 * judgement: that it changes only whitespace, and none a parser could read
 * differently (a space joining two words, a line break ending a statement or
 * a line comment), or that its lines were lifted
 * from (or to) another hunk. Both are cheap to check and easy to get wrong by
 * eye, which is why the CLI states them rather than leaving the model to
 * notice — and why they stay facts: whether a moved block still matters where
 * it landed is the model's call, not this module's.
 *
 * A fact folds a hunk in the stub and hints the model toward folding it, so
 * each one errs toward proving nothing: a hunk left unproven is read, while a
 * behaviour change proven to be whitespace is hidden.
 *
 * A move is found per hunk rather than per file, so it sees a block that git
 * pairs with nothing: a function body lifted into a differently named
 * function, or out of one file into another that already existed. That works
 * best on part-sized hunks (`split-hunks.ts`), where the moved block is most
 * of its hunk rather than a tenth of it.
 */

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/**
 * A move needs at least this share of the significant lines on each side: of
 * what the adding hunk added, so new code wrapped around a moved block is not
 * called a move, and of what the removing hunk removed, so a deletion of which
 * a few lines reappear elsewhere is not called one either.
 */
const MOVE_MIN_SHARE = 0.8;
/** And at least this many distinct distinctive lines in common, so boilerplate never proves a move. */
const MOVE_MIN_DISTINCTIVE = 3;
/** A shorter line (`});`, `end`) says too little to count toward a share. */
const SIGNIFICANT_MIN_CHARS = 4;
/** What can prove a move is at least this long, whitespace collapsed. */
const DISTINCTIVE_MIN_CHARS = 8;
const HAS_WORD_RE = /[\p{L}\p{N}]/u;
const IDENTIFIER_RE = /[\p{L}_$][\p{L}\p{N}_$]{2,}/gu;
/**
 * Keywords and markup every file is full of: a line whose only words are
 * these (`return null;`, `} else {`, `</span>`) turns up in any two hunks.
 */
const FILLER_WORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'const',
  'continue',
  'def',
  'default',
  'div',
  'done',
  'elif',
  'else',
  'elsif',
  'end',
  'endif',
  'false',
  'finally',
  'function',
  'let',
  'new',
  'nil',
  'none',
  'null',
  'pass',
  'raise',
  'return',
  'self',
  'span',
  'then',
  'this',
  'throw',
  'true',
  'try',
  'undefined',
  'var',
]);
const WHITESPACE_RE = /\s+/g;
const WHITESPACE_CHAR_RE = /\s/;
const LEADING_WHITESPACE_RE = /^\s*/;
const QUOTES = new Set(["'", '"', '`']);
const BACKSLASH = '\\';
const WORD_CHAR_RE = /[\p{L}\p{N}_$]/u;
const CLOSING_BRACKETS = new Set([')', ']', '}']);
/** What operators are spelled with: `<-`, `=>`, `!=`, `::`, `?.`, `..`, `/*` and the rest. */
const OPERATOR_CHARS = new Set('+-*/%<>=!&|^~?:.@');

/** Languages the language map names whose indentation is syntax. */
const INDENTED_LANGUAGES = new Set(['coffeescript', 'fsharp', 'markdown', 'pug', 'python', 'yaml']);
/**
 * Indentation-sensitive files the language map cannot name: it draws a
 * makefile, whose recipes are tab-indented, as shell, and Monaco has no
 * Haskell or Sass for it to name.
 */
const INDENTED_FILE_RE = /(?:^|\/)(?:gnu)?makefile$|\.(?:mk|hs|lhs|sass)$/i;

export interface HunkLines {
  removed: string[];
  added: string[];
}

export interface HunkBody extends HunkLines {
  id: string;
  filename: string;
}

/**
 * Each hunk's removed and added lines, in the order `buildDiffHunkIndex`
 * numbers the same text: a hunk header counts only after a `diff --git` line.
 */
export function hunkLines(diff: string): HunkLines[] {
  const hunks: HunkLines[] = [];
  let inFile = false;
  let current: HunkLines | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inFile = true;
      current = null;
      continue;
    }
    if (inFile && HUNK_HEADER_RE.test(line)) {
      current = { removed: [], added: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return hunks;
}

/** Facts by hunk id; a hunk with nothing proven has no entry. */
export function provenFacts(hunks: readonly HunkBody[]): Map<string, HunkFacts> {
  const facts = new Map<string, HunkFacts>();
  const factsOf = (id: string): HunkFacts => {
    let entry = facts.get(id);
    if (!entry) {
      entry = {};
      facts.set(id, entry);
    }
    return entry;
  };

  for (const hunk of hunks) {
    if (isWhitespaceOnly(hunk)) factsOf(hunk.id).whitespaceOnly = true;
  }
  const moves = findMoves(hunks);
  // A block copied to two places was moved from one hunk to both, but the
  // hunk it left names one destination: the one that kept the most of it.
  const bestBySource = new Map<number, Move>();
  for (const move of moves) {
    const to = hunks[move.to]!;
    factsOf(to.id).movedFrom = {
      filename: hunks[move.from]!.filename,
      similarity: move.similarity,
    };
    const rival = bestBySource.get(move.from);
    if (!rival || move.common > rival.common) bestBySource.set(move.from, move);
  }
  for (const move of bestBySource.values()) {
    factsOf(hunks[move.from]!.id).movedTo = {
      filename: hunks[move.to]!.filename,
      similarity: move.similarity,
    };
  }
  return facts;
}

/**
 * Removed and added text equal once each is cut down to its tokens
 * (`tokenText`), which drops blank lines and lets a statement rewrapped over
 * three lines match the one line it was. Where indentation is syntax, each
 * line must also keep its own indentation, so a dedent that takes a statement
 * out of its block is not whitespace; a rewrap there goes unproven.
 */
function isWhitespaceOnly({ filename, removed, added }: HunkBody): boolean {
  if (removed.length + added.length === 0) return false;
  if (!indentationMatters(filename)) {
    return tokenText(removed.join('\n')) === tokenText(added.join('\n'));
  }
  const shape = (lines: readonly string[]) =>
    lines
      .filter((line) => line.trim().length > 0)
      .map((line) => `${LEADING_WHITESPACE_RE.exec(line)![0]}${tokenText(line)}`);
  const before = shape(removed);
  const after = shape(added);
  return before.length === after.length && before.every((line, index) => line === after[index]);
}

function indentationMatters(filename: string): boolean {
  return INDENTED_LANGUAGES.has(detectLanguage(filename)) || INDENTED_FILE_RE.test(filename);
}

/**
 * The text with each run of whitespace outside a string literal cut to what
 * can change how it parses. A run is dropped, except that it stays one space
 * between two characters that could fuse into another token (`not ready`,
 * `a + +b`, `ch < -1`), and one line break where a break can end a statement:
 * the end of a line holding a line comment, which would otherwise swallow the
 * code after it, and a break straight after a word, a closing bracket or a
 * closing quote (`return` then `value;` under JavaScript's semicolon
 * insertion; `compute()` then `-1` in Go, Ruby, Kotlin or Swift) unless a
 * closing bracket follows. That leaves a rewrap that breaks after one of
 * those mid-expression unproven, a method chain broken after `)` among them,
 * the safe way round.
 *
 * A quoted string ends with its line, since only a backtick string spans lines
 * in most languages, and an apostrophe in a comment should not turn the rest
 * of the hunk into a string; on a line holding a line comment a backtick ends
 * there too. A regex literal is not lexed, so a change to the spacing inside
 * one alone would be missed.
 */
function tokenText(text: string): string {
  let out = '';
  let quote: string | null = null;
  let lineComment = false;
  let inRun = false;
  let breakAfterComment = false;
  let breakAfterEnd = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\n' && (quote !== '`' || lineComment)) {
        quote = null;
      } else {
        out += char;
        if (char === BACKSLASH) {
          out += text[index + 1] ?? '';
          index += 1;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
    }
    if (WHITESPACE_CHAR_RE.test(char)) {
      if (char === '\n') {
        if (lineComment) breakAfterComment = true;
        else if (canEndStatement(out.at(-1) ?? '')) breakAfterEnd = true;
        lineComment = false;
      }
      inRun = true;
      continue;
    }
    if (inRun && out.length > 0) {
      if (breakAfterComment || (breakAfterEnd && !CLOSING_BRACKETS.has(char))) out += '\n';
      else if (fuses(out.at(-1)!, char)) out += ' ';
    }
    inRun = false;
    breakAfterComment = false;
    breakAfterEnd = false;
    if (QUOTES.has(char)) quote = char;
    else if (startsLineComment(text, index)) lineComment = true;
    out += char;
  }
  return out;
}

/**
 * The last character outside a string before a line break. A quote there
 * closed its string: an opening one would have left the scan inside it.
 */
function canEndStatement(last: string): boolean {
  return WORD_CHAR_RE.test(last) || CLOSING_BRACKETS.has(last) || QUOTES.has(last);
}

/** Two words, or any two operator characters, since some language reads nearly every such pair as one. */
function fuses(left: string, right: string): boolean {
  if (WORD_CHAR_RE.test(left) && WORD_CHAR_RE.test(right)) return true;
  return OPERATOR_CHARS.has(left) && OPERATOR_CHARS.has(right);
}

/** `//`, `#` or `--`, read generously: a false comment only keeps a line break that did not matter. */
function startsLineComment(text: string, index: number): boolean {
  const char = text[index];
  if (char === '#') return true;
  return (char === '/' || char === '-') && text[index + 1] === char;
}

/** A hunk's significant lines as a multiset: whitespace collapsed, long enough, holding a word. */
function significant(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const collapsed = line.replace(WHITESPACE_RE, ' ').trim();
    if (collapsed.length < SIGNIFICANT_MIN_CHARS || !HAS_WORD_RE.test(collapsed)) continue;
    counts.set(collapsed, (counts.get(collapsed) ?? 0) + 1);
  }
  return counts;
}

/** A significant line that could be in both hunks only because it moved: long, with a word of its own. */
function isDistinctive(line: string): boolean {
  if (line.length < DISTINCTIVE_MIN_CHARS) return false;
  for (const [word] of line.matchAll(IDENTIFIER_RE)) {
    if (!FILLER_WORDS.has(word.toLowerCase())) return true;
  }
  return false;
}

function sum(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

interface Move {
  /** Index of the hunk that removed the lines. */
  from: number;
  /** Index of the hunk that added them. */
  to: number;
  similarity: number;
  common: number;
}

/**
 * For each adding hunk, the removing hunk it shares the most significant
 * lines with, when that clears every threshold; ties go to the earlier hunk.
 * The similarity is the smaller of the two shares, so both ends report one
 * number and neither overstates the match.
 *
 * Only a one-sided hunk is either end of a move: a hunk that removes lines
 * and adds others edits in place, whatever its lines resemble elsewhere. That
 * also keeps a hunk from matching itself.
 *
 * Matched through an index of removed lines rather than hunk against hunk, so
 * a change of a few thousand hunks costs what its lines cost.
 */
function findMoves(hunks: readonly HunkBody[]): Move[] {
  const sides = hunks.map((hunk) => {
    const removed = significant(hunk.removed);
    const added = significant(hunk.added);
    return { removed, added, removedTotal: sum(removed), addedTotal: sum(added) };
  });

  const removedIndex = new Map<string, { hunk: number; count: number }[]>();
  sides.forEach(({ removed, addedTotal }, index) => {
    if (addedTotal > 0) return;
    for (const [line, count] of removed) {
      const holders = removedIndex.get(line) ?? [];
      holders.push({ hunk: index, count });
      removedIndex.set(line, holders);
    }
  });

  const moves: Move[] = [];
  sides.forEach(({ added, addedTotal, removedTotal }, index) => {
    if (removedTotal > 0 || addedTotal === 0) return;

    const common = new Map<number, { shared: number; distinctive: number }>();
    for (const [line, count] of added) {
      const distinctive = isDistinctive(line);
      for (const holder of removedIndex.get(line) ?? []) {
        const entry = common.get(holder.hunk) ?? { shared: 0, distinctive: 0 };
        entry.shared += Math.min(count, holder.count);
        if (distinctive) entry.distinctive += 1;
        common.set(holder.hunk, entry);
      }
    }

    let best: Move | null = null;
    for (const [source, { shared, distinctive }] of common) {
      if (distinctive < MOVE_MIN_DISTINCTIVE) continue;
      const share = Math.min(shared / addedTotal, shared / sides[source]!.removedTotal);
      if (share < MOVE_MIN_SHARE) continue;
      if (best && (shared < best.common || (shared === best.common && source > best.from))) {
        continue;
      }
      best = { from: source, to: index, similarity: Math.round(100 * share), common: shared };
    }
    if (best) moves.push(best);
  });
  return moves;
}
