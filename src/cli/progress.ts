import { note } from './terminal.ts';

/**
 * What the terminal shows while the model works: one line per tool the agent
 * uses, stamped with elapsed time and with the turn it happened on, plus a
 * line for each chapter title as the answer streams in. A review can run to
 * the turn limit, so the log is the only record of how it got there — and
 * worth the length, since the cost of a run failing on `error_max_turns` is
 * the whole run's effort, not a scrollback.
 *
 * The turn comes from the message loop rather than from counting the lines
 * here: a turn that asks for four files at once is one turn and prints four
 * lines, and the whole point of the number is to be read against
 * `--max-turns`.
 *
 * Chapter titles are picked out of the answer as it streams, before there is
 * enough JSON to parse: an object that opens with an `id` immediately followed
 * by a `title` is a chapter or a diagram, which is what separates both from
 * the insights inside a chapter. A diagram is told apart by the key it sits
 * under. Missing one costs nothing — no line for it — so this stays a regex
 * rather than a streaming parser.
 */
const TITLED_OBJECT = /(?:"(\w+)"\s*:\s*)?\{\s*"id"\s*:\s*"[^"]*"\s*,\s*"title"\s*:\s*"([^"]*)"/g;
const DIAGRAM_KEYS = new Set(['diagram', 'overviewDiagram']);

/**
 * Silence longer than this gets a line of its own. A turn can spend minutes
 * inside one `Bash` call or thinking before it says anything, and an
 * unchanging screen is the difference between "working" and "hung".
 */
const HEARTBEAT_MS = 20_000;

export interface RunProgress {
  /** A tool the agent used, and the turn it was used on. */
  activity(what: string, turn: number): void;
  /** A block of the answer, as it arrives. */
  text(chunk: string): void;
  /**
   * The answer was refused and the model is writing the whole of it again,
   * so its chapters count from one: carrying on from the refused answer's
   * count would read as a review twice as long.
   */
  answerAgain(): void;
  /** The run is over: stop the heartbeat. */
  stop(): void;
}

export interface ProgressDeps {
  print: (text: string) => void;
  now: () => number;
  /** Looks for silence once a second, so a slow turn still shows a sign of life. */
  every: (tick: () => void, ms: number) => { stop: () => void };
}

export const HOST_PROGRESS_DEPS: ProgressDeps = {
  print: note,
  now: () => Date.now(),
  every: (tick, ms) => {
    const timer = setInterval(tick, ms);
    // Never hold the process open for the sake of a heartbeat.
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
  let answer = '';
  let scanned = 0;
  let chapters = 0;
  let lastPrintedAt = startedAt;

  const print = (text: string) => {
    lastPrintedAt = deps.now();
    deps.print(`  run     ${elapsed(lastPrintedAt - startedAt)}  ${text}`);
  };
  print('starting the agent');
  const heartbeat = deps.every(() => {
    if (deps.now() - lastPrintedAt >= HEARTBEAT_MS) print('still working');
  }, 1000);

  return {
    activity(what: string, turn: number) {
      print(`[${String(turn)}] ${what}`);
    },
    text(chunk: string) {
      answer += chunk;
      // Re-scan only the part no complete title has been found in yet.
      const from = scanned;
      const tail = answer.slice(from);
      TITLED_OBJECT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = TITLED_OBJECT.exec(tail)) !== null) {
        // `match.index` is an offset into `tail`, so the cursor is measured
        // from where `tail` starts — not from wherever an earlier match in
        // this same pass already moved it to.
        scanned = from + match.index + match[0].length;
        if (DIAGRAM_KEYS.has(match[1] ?? '')) continue;
        chapters += 1;
        print(`writing chapter ${String(chapters)}: ${match[2] ?? ''}`);
      }
    },
    answerAgain() {
      chapters = 0;
      scanned = answer.length;
    },
    stop() {
      heartbeat.stop();
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
