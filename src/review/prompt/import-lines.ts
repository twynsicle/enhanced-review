/**
 * Which lines of a TypeScript or JavaScript file are import wiring: a
 * top-level `import … from '…'`, a side-effect `import '…'`, or a re-export
 * `export … from '…'`, each over as many lines as it is written on. What
 * `hunk-facts.ts` proves a hunk imports-only from.
 *
 * Read from the whole file rather than the hunk, because a line a hunk adds
 * to a long import list (`  formatDate,`) says nothing on its own, and the
 * `import {` that opens it can be well above the hunk's context.
 *
 * No parser: TypeScript's own has no JavaScript API to call from here. A
 * scan instead finds where each line starts — in code at the top level, or
 * inside a string, comment, template or bracket — and a statement is only
 * read from a line that starts at the top level, so an import written inside
 * a test's template string is never taken for one. Regular expression
 * literals are not tracked; a quote inside one is closed at the end of its
 * line, and the cost of the rare one that misleads the scan is a hunk left
 * unproven, never one proven wrongly, since a statement must still match in
 * full. Everything errs that way: an import with a comment inside its braces,
 * or anything after it on its line, is simply not counted.
 */

const SCRIPT_FILE_RE = /\.[cm]?[jt]sx?$/i;

/**
 * One import or re-export statement from its first line, through the module
 * string, to the end of its line: an optional import attribute, `;` and line
 * comment may follow, and nothing else may.
 */
const STATEMENT_RE =
  /[ \t]*(?:import(?:\s+type)?(?=[\s{*'"])(?:[\w$*\s{},]*?\bfrom)?|export(?:\s+type)?\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[\w$\s,]*\})\s*from)\s*(['"])[^'"\r\n]*\1(?:\s+(?:with|assert)\s*\{[^}\r\n]*\})?[ \t]*;?[ \t]*(?:\/\/[^\r\n]*)?(?=\r?\n|$)/y;

const STATEMENT_START_RE = /^[ \t]*(?:import|export)\b/;

export function isScriptFile(filename: string): boolean {
  return SCRIPT_FILE_RE.test(filename);
}

/** The 1-based numbers of the lines that are import wiring. */
export function importLines(text: string): Set<number> {
  const lines = new Set<number>();
  const starts = lineStarts(text);
  let offset = 0;
  let lineNumber = 1;
  const lineCount = starts.length - 1;
  while (lineNumber <= lineCount) {
    const end = text.indexOf('\n', offset);
    const line = text.slice(offset, end === -1 ? undefined : end);
    if (starts[lineNumber]!.topLevel && STATEMENT_START_RE.test(line)) {
      STATEMENT_RE.lastIndex = offset;
      const match = STATEMENT_RE.exec(text);
      if (match) {
        const spans = match[0].split('\n').length;
        for (let i = 0; i < spans; i += 1) lines.add(lineNumber + i);
        lineNumber += spans;
        offset = starts[lineNumber]?.offset ?? text.length;
        continue;
      }
    }
    lineNumber += 1;
    offset = end === -1 ? text.length : end + 1;
  }
  return lines;
}

type Mode = 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template';

interface LineStart {
  offset: number;
  /** In code, outside every bracket: where a module's own statements start. */
  topLevel: boolean;
}

/** Each line's start, indexed by its 1-based number. */
function lineStarts(text: string): LineStart[] {
  const starts: LineStart[] = [
    { offset: 0, topLevel: false },
    { offset: 0, topLevel: true },
  ];
  let mode: Mode = 'code';
  let depth = 0;
  // The bracket depth each open `${` returns its template to.
  const templates: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (char === '\n') {
      // A quote is never open across a line; one that seems to be was a
      // regular expression or a mistake, and either way the next line is code.
      if (mode === 'line-comment' || mode === 'single' || mode === 'double') mode = 'code';
      starts.push({ offset: i + 1, topLevel: mode === 'code' && depth === 0 });
      continue;
    }
    switch (mode) {
      case 'code':
        if (char === '/' && next === '/') {
          mode = 'line-comment';
          i += 1;
        } else if (char === '/' && next === '*') {
          mode = 'block-comment';
          i += 1;
        } else if (char === "'") mode = 'single';
        else if (char === '"') mode = 'double';
        else if (char === '`') mode = 'template';
        else if (char === '{' || char === '(' || char === '[') depth += 1;
        else if (char === '}' && templates.at(-1) === depth - 1) {
          depth -= 1;
          templates.pop();
          mode = 'template';
        } else if (char === '}' || char === ')' || char === ']') depth = Math.max(0, depth - 1);
        break;
      case 'block-comment':
        if (char === '*' && next === '/') {
          mode = 'code';
          i += 1;
        }
        break;
      case 'single':
      case 'double':
        if (char === BACKSLASH && next !== '\n') i += 1;
        else if (char === (mode === 'single' ? "'" : '"')) mode = 'code';
        break;
      case 'template':
        if (char === BACKSLASH && next !== '\n') i += 1;
        else if (char === '`') mode = 'code';
        else if (char === '$' && next === '{') {
          templates.push(depth);
          depth += 1;
          mode = 'code';
          i += 1;
        }
        break;
      case 'line-comment':
        break;
    }
  }
  return starts;
}

const BACKSLASH = String.fromCharCode(92);
