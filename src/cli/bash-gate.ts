/**
 * What the local agent may run with `Bash` (docs/local-mode phase 4).
 *
 * A local review reads the engineer's own repository, so it gets history —
 * `git log`, `git blame`, `git show` — on top of the hosted Read/Glob/Grep.
 * Nothing else: `Bash` is left out of `allowedTools`, so every command
 * arrives here first, and anything this function does not recognise as a
 * read is refused with a message telling the agent what it may run instead.
 *
 * The rules are deliberately blunt. A command is refused unless it is a
 * single invocation of a known program, with no shell syntax that could
 * chain, redirect or substitute another one, and no argument that turns a
 * listed program into a launcher for an unlisted one.
 */

/** Anything that could start a second command, write a file, or expand into either. */
const SHELL_SYNTAX = /[;&|<>`\n\r]|\$\(|\$\{/;

const PROGRAMS = new Set(['git', 'rg', 'ls', 'cat', 'head', 'tail', 'wc']);

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
  'er allows read-only commands only: git log/show/diff/blame/status and similar, rg, ls, cat, ' +
  'head, tail, wc — one command at a time, with no pipes, redirection or command substitution.';

export function reviewBashCommand(command: string): BashDecision {
  const trimmed = command.trim();
  if (trimmed === '') return deny('an empty command');
  if (SHELL_SYNTAX.test(trimmed)) {
    return deny('shell syntax that could run or write something else');
  }

  const words = splitWords(trimmed);
  const program = words[0];
  if (program === undefined || !PROGRAMS.has(program)) {
    return deny(`\`${program ?? trimmed}\` is not one of the commands er allows`);
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

function deny(what: string): BashDecision {
  return { allowed: false, reason: `Refused ${what}. ${REFUSAL}` };
}

/**
 * Words, treating a quoted run as one word. Quoting cannot hide shell syntax
 * from this gate, because the whole command was rejected for it already.
 */
function splitWords(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) =>
    /^(".*"|'.*')$/.test(word) ? word.slice(1, -1) : word,
  );
}
