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
    expect(refusal('git log | sh')).toContain('shell syntax');
    expect(refusal('')).toContain('empty command');
  });
});
