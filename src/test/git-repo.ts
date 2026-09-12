import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostEnv } from '../config/host-env.ts';

/**
 * How long a test that drives this helper is given.
 *
 * Standing up a repo with a bare origin costs a few dozen `git` invocations,
 * and on Windows each one is a process spawn the virus scanner gets a look at
 * first: a single test here runs 2.5–3 s on an idle machine. Vitest's 5 s
 * default leaves so little headroom that these files fail the moment `npm run
 * check` has the other projects competing for the same cores — which looks
 * like flakiness and is really just a timeout set for tests that do not fork.
 *
 * Each file that uses this helper spends it through `vi.setConfig`, rather than
 * the whole `unit` project carrying it, so a pure-logic test that starts taking
 * seconds is still caught.
 */
export const GIT_TEST_TIMEOUT = 30_000;

/**
 * A throwaway repository with a bare `origin`, for tests that drive real git.
 * The user's global config still applies, so the settings that would change
 * what a test sees (signing, line-ending conversion) are pinned per repo.
 */
export interface TempRepo {
  /** The working clone. */
  work: string;
  /** The bare repository `work` has as `origin`. */
  origin: string;
  git: (...args: string[]) => string;
  write: (file: string, content: string | Buffer) => void;
  /** Stages everything and commits; returns the new HEAD. */
  commit: (message: string) => string;
  cleanup: () => void;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.test',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'author@example.test',
};

function run(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...hostEnv(), ...IDENTITY },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A repository whose `main` has one commit, pushed to origin. */
export function createTempRepo(): TempRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'cli-test-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  run(root, ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  run(root, ['init', '--quiet', '--initial-branch=main', work]);
  for (const [key, value] of [
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
  ] as const) {
    run(work, ['config', key, value]);
  }
  run(work, ['remote', 'add', 'origin', origin]);

  const git = (...args: string[]) => run(work, args);
  const write = (file: string, content: string | Buffer) => {
    const full = path.join(work, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const commit = (message: string) => {
    git('add', '--all');
    git('commit', '--quiet', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };

  write('README.md', '# fixture\n');
  commit('initial');
  git('push', '--quiet', 'origin', 'main');
  return {
    work,
    origin,
    git,
    write,
    commit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
