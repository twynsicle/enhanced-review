import { describe, expect, it } from 'vitest';
import { reviewBashCommand } from './bash-gate.ts';

const allows = (command: string) => reviewBashCommand(command).allowed;
/** The commands from `list` that this gate got wrong, so a failure names them. */
const wrongly = (list: string[], expected: boolean) =>
  list.filter((command) => allows(command) !== expected);
const refusal = (command: string) => {
  const decision = reviewBashCommand(command);
  return decision.allowed ? '' : decision.reason;
};

describe('what the local agent may run', () => {
  it('allows the read-only commands a reviewer needs', () => {
    const commands = [
      'git log --oneline -20 -- src/cli',
      'git blame -L 10,40 src/cli/review.ts',
      'git show d6156cf:src/cli/worktree.ts',
      'git diff --stat HEAD~1',
      'git status --porcelain',
      'git merge-base HEAD origin/main',
      "rg --files-with-matches 'addWorktree' src",
      'ls src/cli',
      'wc -l src/cli/review.ts',
    ];
    expect(wrongly(commands, true)).toEqual([]);
  });

  /**
   * Every Bash command the model tried in the first real review was refused,
   * because it reaches for history the way a person does: from a directory it
   * names itself, and through `head` so the answer stays short (phase 4
   * result). Each of these is still only reads.
   */
  it('allows the chained form the model actually asks in', () => {
    const commands = [
      'cd "C:/workspace/diffy/enhanced-review" && ls er-reviews/branch-x/context/diff | head -100',
      'cd "C:/x/context/diff" && cat "src/cli/review.ts.diff" 2>/dev/null | head -150',
      'cd "C:/workspace/diffy/enhanced-review" && git diff 639b79d..22511ed -- package.json | head -150',
      'cd "C:/workspace/diffy/enhanced-review" && git diff 639b79d..22511ed -- src/guardrails/helpers.ts',
      "git log --oneline | rg 'worktree' | head -5",
    ];
    expect(wrongly(commands, true)).toEqual([]);
  });

  it('still refuses a chain with anything but a read in it', () => {
    const commands = [
      'cd /tmp && rm -rf .',
      'git log | tee out.txt',
      'git log && git push',
      'cat package.json | node',
      'ls | xargs rm',
      'git log &',
    ];
    expect(wrongly(commands, false)).toEqual([]);
  });

  it('refuses anything that writes, or that is not on the list', () => {
    const commands = [
      'git push',
      'git commit -m x',
      'git checkout -- .',
      'git config user.email x',
      'npm run build',
      'rm -rf .',
      'node -e "process.exit(0)"',
    ];
    expect(wrongly(commands, false)).toEqual([]);
  });

  it('refuses shell syntax that could smuggle a second command', () => {
    const commands = [
      'git log; rm -rf .',
      'git log && git push',
      'git log | tee out.txt',
      'cat package.json > stolen.json',
      'git log `whoami`',
      'git log $(whoami)',
      'git log\nrm -rf .',
    ];
    expect(wrongly(commands, false)).toEqual([]);
  });

  it('refuses arguments that turn an allowed program into a launcher', () => {
    expect(allows('rg --pre sh pattern .')).toBe(false);
    expect(allows('git -c core.pager=sh log')).toBe(false);
    expect(allows('git diff --output=/tmp/patch HEAD~1')).toBe(false);
  });

  it('says what is allowed when it refuses', () => {
    expect(refusal('git push')).toContain('read-only git commands');
    expect(refusal('rm -rf .')).toContain('not one of the commands er allows');
    expect(refusal('git log | sh')).toContain('`sh` is not one of the commands');
    expect(refusal('cat x > out')).toContain('redirection');
    expect(refusal('git log; rm -rf .')).toContain('could run something else');
    expect(refusal('')).toContain('empty command');
  });
});
