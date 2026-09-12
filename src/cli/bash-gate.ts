/**
 * What the local agent may run with `Bash`.
 *
 * A local review reads the engineer's own repository, so it gets history —
 * `git log`, `git blame`, `git show` — on top of the hosted Read/Glob/Grep.
 * Nothing else: `Bash` is left out of `allowedTools`, so every command
 * arrives here first, and anything this function does not recognise as a
 * read is refused with a message telling the agent what it may run instead.
 *
 * The rule is that every command in the line must be a read. A pipeline and
 * a `cd … && …` prefix are how the model actually asks for history — an
 * earlier gate banned both outright and refused all four commands the first
 * real review tried — so they are split apart and each part is checked on its
 * own: the line is allowed only if all of them are known read-only
 * invocations, with no syntax that could start something unlisted, and no
 * argument that turns a listed program into a launcher for one.
 */

/** Characters that could start a command this gate never sees. */
const FORBIDDEN_SYNTAX = /[;`<(){}\n\r]/;

/** Discarding stderr is a read; it is also the only redirection allowed. */
const STDERR_DISCARD = /\s2>\s*(?:\/dev\/null|[Nn][Uu][Ll])(?=\s|$)/g;

const PROGRAMS = new Set(['cd', 'git', 'rg', 'grep', 'ls', 'cat', 'head', 'tail', 'wc']);

/** `git` subcommands that only read. `config` is absent on purpose: it writes. */
const GIT_SUBCOMMANDS = new Set([
  'blame',
  'cat-file',
  'describe',
  'diff',
  'log',
  'ls-files',
  'ls-tree',
  'merge-base',
  'name-rev',
  'rev-parse',
  'shortlog',
  'show',
  'show-ref',
  'status',
]);

/**
 * Arguments that make an allowed program run something else or write a file:
 * `git --output=` writes the diff out, `git -c` sets config for the command
 * (including hook and pager paths), and ripgrep's preprocessor flags name a
 * program to execute.
 */
const FORBIDDEN_ARGUMENTS = ['-c', '--output', '--pre', '--hostname-bin', '--exec', '-exec'];

export type BashDecision = { allowed: true } | { allowed: false; reason: string };

const REFUSAL =
  'er allows read-only commands only: git log/show/diff/blame/status and similar, rg, grep, ls, ' +
  'cat, head, tail, wc. They may be chained with `|` or `&&` as long as every command in the ' +
  'line is one of those; redirection and command substitution are not available.';

export function reviewBashCommand(command: string): BashDecision {
  const trimmed = command.trim();
  if (trimmed === '') return deny('an empty command');

  const split = splitChain(trimmed.replace(STDERR_DISCARD, ' '));
  if (!split.ok) return deny(split.reason);

  for (const part of split.parts) {
    const decision = reviewOne(part);
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}

/** One command: a known program, run in a way that only reads. */
function reviewOne(command: string): BashDecision {
  const words = splitWords(command.trim());
  const program = words[0];
  if (program === undefined) return deny('an empty command in the line');
  if (!PROGRAMS.has(program)) {
    return deny(`\`${program}\` is not one of the commands er allows`);
  }

  const rest = words.slice(1);
  for (const word of rest) {
    const flag = word.split('=')[0]!;
    if (FORBIDDEN_ARGUMENTS.includes(flag)) {
      return deny(`\`${flag}\` can run or write something else`);
    }
  }

  if (program === 'git') {
    // Skip the global flags that may precede a subcommand (`git -P log`).
    const subcommand = rest.find((word) => !word.startsWith('-'));
    if (subcommand === undefined) return deny('`git` with no subcommand');
    if (!GIT_SUBCOMMANDS.has(subcommand)) {
      return deny(`\`git ${subcommand}\` is not one of the read-only git commands er allows`);
    }
  }

  return { allowed: true };
}

type Chain = { ok: true; parts: string[] } | { ok: false; reason: string };

/**
 * The line broken at `|`, `||` and `&&`, respecting quotes so a separator
 * inside a search pattern stays part of it. Anything else that could reach a
 * second program — a `;`, a subshell, a redirection, a substitution, a
 * background `&` — ends the scan instead, because splitting on it would not
 * be enough to check what it runs.
 */
function splitChain(command: string): Chain {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '|' || char === '&') {
      const doubled = command[i + 1] === char;
      if (char === '&' && !doubled) return { ok: false, reason: 'a backgrounded command' };
      parts.push(current);
      current = '';
      if (doubled) i += 1;
      continue;
    }
    if (char === '>') return { ok: false, reason: 'redirection, which writes' };
    if (char === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) {
      return { ok: false, reason: 'a substitution, which could expand to another command' };
    }
    if (FORBIDDEN_SYNTAX.test(char)) {
      return { ok: false, reason: `\`${char}\`, which could run something else` };
    }
    current += char;
  }

  if (quote !== null) return { ok: false, reason: 'an unclosed quote' };
  parts.push(current);
  return { ok: true, parts };
}

function deny(what: string): BashDecision {
  return { allowed: false, reason: `Refused ${what}. ${REFUSAL}` };
}

/**
 * Words, treating a quoted run as one word. Quoting cannot hide a separator
 * from this gate: the line was split before it was cut into words.
 */
function splitWords(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) =>
    /^(".*"|'.*')$/.test(word) ? word.slice(1, -1) : word,
  );
}
