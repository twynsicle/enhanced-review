import { note } from './terminal.ts';

/**
 * What the terminal shows while the model works: one line per turn, numbered
 * and stamped with elapsed time, plus a line for each chapter title as the
 * answer streams in. A review can run to the turn limit, so the log is the
 * only record of how it got there — and worth the length, since the cost of
 * a run failing on `error_max_turns` is the whole run's effort, not a
 * scrollback.
 *
 * Chapter titles are picked out of the answer as it streams, before there is
 * enough JSON to parse: a chapter is the only object that carries an `id`
 * immediately followed by a `title`, which is what separates it from the
 * insights inside it. Missing one costs nothing — no line for it — so this
 * stays a regex rather than a streaming parser.
 */
const CHAPTER_TITLE = /"id"\s*:\s*"[^"]*"\s*,\s*"title"\s*:\s*"([^"]*)"/g;

export interface RunProgress {
  /** A tool the agent used, one per turn. */
  activity(what: string): void;
  /** A block of the answer, as it arrives. */
  text(chunk: string): void;
}

export interface ProgressDeps {
  print: (text: string) => void;
  now: () => number;
}

export const HOST_PROGRESS_DEPS: ProgressDeps = {
  print: note,
  now: () => Date.now(),
};

export function startProgress(deps: ProgressDeps = HOST_PROGRESS_DEPS): RunProgress {
  const startedAt = deps.now();
  let turn = 0;
  let answer = '';
  let scanned = 0;
  let chapters = 0;

  const print = (text: string) => {
    deps.print(`  run     ${elapsed(deps.now() - startedAt)}  ${text}`);
  };
  print('starting the agent');

  return {
    activity(what: string) {
      turn += 1;
      print(`[${String(turn)}] ${what}`);
    },
    text(chunk: string) {
      answer += chunk;
      // Re-scan only the part no complete title has been found in yet.
      const tail = answer.slice(scanned);
      CHAPTER_TITLE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CHAPTER_TITLE.exec(tail)) !== null) {
        chapters += 1;
        scanned += match.index + match[0].length;
        print(`writing chapter ${String(chapters)}: ${match[1] ?? ''}`);
      }
    },
  };
}

/** `48s`, then `2m 05s`. */
export function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
