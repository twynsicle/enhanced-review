/**
 * What the local agent may run with `Bash`.
 *
 * A local review reads the engineer's own repository, so it gets history —
 * `git log`, `git blame`, `git show` — on top of Read/Glob/Grep.
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
 *
 * The line is read the way bash will read it, quotes removed, because the
 * words checked here must be the words bash runs: a gate that stops looking
 * inside double quotes lets `"$(…)"` through, and one that checks `-"c"` as
 * written lets bash run `-c`. Whatever this reader does not model — escapes,
 * expansions, a glob that could expand to a flag — is refused rather than
 * guessed at.
 */

/** Characters that could start a command this gate never sees. */
const FORBIDDEN_SYNTAX = /[;`<(){}\n\r\\]/;

/**
 * Discarding stderr is a read; it is also the only redirection allowed. It
 * comes out before the line is read, so the `>` in it is never seen.
 */
const STDERR_DISCARD = /\s2>\s*(?:\/dev\/null|[Nn][Uu][Ll])(?=\s|$)/g;

/**
 * Glob characters. One that could expand to a flag — at the start of a word,
 * or in a word that starts with a dash — is refused: a file in the reviewed
 * tree named `--pre=sh` would answer it.
 */
const GLOB = /[*?[]/;

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
 * Arguments that make an allowed program run something else or write a file.
 * For git: `--output` writes the diff out, `-c` and `--config-env` set config
 * for the command (hook, pager and diff-driver commands among it), and
 * `--git-dir`, `--work-tree`, `--exec-path` and `-C` point git somewhere the
 * reviewed tree could have prepared. For ripgrep: the preprocessor flags name
 * a program to execute. Per program, because `-c` and `-C` are harmless
 * counts and context to grep, rg and wc.
 */
const FORBIDDEN_ARGUMENTS: Record<string, readonly string[]> = {
  git: ['-c', '-C', '--config-env', '--exec-path', '--git-dir', '--work-tree', '--output'],
  rg: ['--pre', '--hostname-bin'],
};

export type BashDecision = { allowed: true } | { allowed: false; reason: string };

const REFUSAL =
  'er allows read-only commands only: git log/show/diff/blame/status and similar, rg, grep, ls, ' +
  'cat, head, tail, wc. They may be chained with `|` or `&&` as long as every command in the ' +
  'line is one of those; redirection, substitution, variables, backslashes and globs are not ' +
  'available, so write paths with forward slashes and quote search patterns in single quotes.';

export function reviewBashCommand(command: string): BashDecision {
  const trimmed = command.trim();
  if (trimmed === '') return deny('an empty command');

  const read = readLine(trimmed.replace(STDERR_DISCARD, ' '));
  if (!read.ok) return deny(read.reason);

  for (const words of read.commands) {
    const decision = reviewOne(words);
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}

/** One command, as the words bash will pass it: a known program, run in a way that only reads. */
function reviewOne(words: string[]): BashDecision {
  const program = words[0];
  if (program === undefined) return deny('an empty command in the line');
  if (!PROGRAMS.has(program)) {
    return deny(`\`${program}\` is not one of the commands er allows`);
  }

  const rest = words.slice(1);
  const forbidden = FORBIDDEN_ARGUMENTS[program] ?? [];
  for (const word of rest) {
    const flag = word.split('=')[0]!;
    if (forbidden.includes(flag)) {
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

type Line = { ok: true; commands: string[][] } | { ok: false; reason: string };

/**
 * The line as bash will split it: commands broken at `|`, `||` and `&&`, each
 * cut into words with the quotes removed. Inside single quotes everything is
 * literal. Inside double quotes bash still expands `$…` and backticks and
 * honours backslashes, so those are refused there; a `$` is let through only
 * where bash leaves it as a character, before the closing quote or a space
 * (`grep "end$"`). Outside quotes, anything that could reach a second program
 * — a `;`, a subshell, a redirection, a substitution, a background `&` — ends
 * the scan, because splitting on it would not be enough to check what it runs.
 */
function readLine(line: string): Line {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  /** Whether a word has started: `''` is a word, and so is `""`. */
  let inWord = false;
  let quote: "'" | '"' | null = null;

  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    commands.push(words);
    words = [];
  };

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    const next = line[i + 1];

    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === '`' || char === '\\') {
        return { ok: false, reason: `\`${char}\` inside double quotes, which bash still reads` };
      }
      if (char === '$' && next !== '"' && next !== ' ') {
        return { ok: false, reason: 'a `$` expansion inside double quotes' };
      }
      word += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      endWord();
      continue;
    }
    if (char === '|' || char === '&') {
      const doubled = next === char;
      if (char === '&' && !doubled) return { ok: false, reason: 'a backgrounded command' };
      endCommand();
      if (doubled) i += 1;
      continue;
    }
    if (char === '>') return { ok: false, reason: 'redirection, which writes' };
    if (char === '$') {
      return { ok: false, reason: 'a `$` expansion, which could expand to another command' };
    }
    if (FORBIDDEN_SYNTAX.test(char)) {
      return { ok: false, reason: `\`${char}\`, which could run something else` };
    }
    if (GLOB.test(char) && (word === '' || word.startsWith('-'))) {
      return { ok: false, reason: 'a glob that could expand to a flag' };
    }
    word += char;
    inWord = true;
  }

  if (quote !== null) return { ok: false, reason: 'an unclosed quote' };
  endCommand();
  return { ok: true, commands };
}

function deny(what: string): BashDecision {
  return { allowed: false, reason: `Refused ${what}. ${REFUSAL}` };
}
