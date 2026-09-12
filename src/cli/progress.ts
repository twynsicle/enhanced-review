import { clearStatus, status } from './terminal.ts';

/**
 * What the terminal shows while the model works (docs/local-mode D12): how
 * long it has been going, and either the file it is reading or the chapter
 * it is writing. A review takes minutes, so a still screen is the difference
 * between "working" and "hung".
 *
 * Chapter titles are picked out of the answer as it streams, before there is
 * enough JSON to parse: a chapter is the only object that carries an `id`
 * immediately followed by a `title`, which is what separates it from the
 * insights inside it. Missing one costs nothing — the line simply does not
 * change — so this stays a regex rather than a streaming parser.
 */
const CHAPTER_TITLE = /"id"\s*:\s*"[^"]*"\s*,\s*"title"\s*:\s*"([^"]*)"/g;

export interface RunProgress {
  /** A tool the agent used. */
  activity(what: string): void;
  /** A block of the answer, as it arrives. */
  text(chunk: string): void;
  /** Take the line down; the stage line goes where it was. */
  stop(): void;
}

export interface ProgressDeps {
  status: (text: string) => void;
  clear: () => void;
  now: () => number;
  /** Redraw every second, so the clock moves while the agent thinks. */
  every: (tick: () => void, ms: number) => { stop: () => void };
}

export const HOST_PROGRESS_DEPS: ProgressDeps = {
  status,
  clear: clearStatus,
  now: () => Date.now(),
  every: (tick, ms) => {
    const timer = setInterval(tick, ms);
    // Never hold the process open for the sake of a progress line.
    timer.unref();
    return {
      stop: () => {
        clearInterval(timer);
      },
    };
  },
};

export function startProgress(deps: ProgressDeps = HOST_PROGRESS_DEPS): RunProgress {
  const startedAt = deps.now();
  let doing = 'starting the agent';
  let answer = '';
  let scanned = 0;
  let chapters = 0;

  const draw = () => {
    deps.status(`  run     ${elapsed(deps.now() - startedAt)}  ${doing}`);
  };
  const ticker = deps.every(draw, 1000);
  draw();

  return {
    activity(what: string) {
      doing = what;
      draw();
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
        doing = `writing chapter ${String(chapters)}: ${match[1] ?? ''}`;
      }
      draw();
    },
    stop() {
      ticker.stop();
      deps.clear();
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
