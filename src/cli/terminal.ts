import { styleText } from 'node:util';

/**
 * Everything `er` prints goes through here: progress on stdout, problems on
 * stderr. Colour follows the stream (off when piped, or when NO_COLOR is set).
 */
type Style = Parameters<typeof styleText>[0];

function paint(style: Style, text: string, stream: NodeJS.WriteStream): string {
  return styleText(style, text, { stream });
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

/** One finished stage: `  gather   24 files, 57 hunks   1.2s`. */
export function stage(name: string, detail: string, ms: number): void {
  const time = ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
  line(
    `  ${paint('bold', name.padEnd(7), process.stdout)} ${detail}  ${paint('dim', time, process.stdout)}`,
  );
}

export function note(text: string): void {
  line(paint('dim', text, process.stdout));
}

export function warn(text: string): void {
  process.stderr.write(`${paint('yellow', 'warning', process.stderr)} ${text}\n`);
}

export function fail(text: string): void {
  process.stderr.write(`${paint('red', 'error', process.stderr)} ${text}\n`);
}

/**
 * The live line a long stage keeps updating in place: the model run's
 * elapsed time and what the agent is doing. It exists
 * only on a terminal — piped or redirected output gets the stage lines and
 * nothing else, so a log never fills with half-drawn lines.
 */
const CLEAR_LINE = String.fromCharCode(13) + String.fromCharCode(27) + '[2K';

export function status(text: string): void {
  if (process.stdout.isTTY !== true) return;
  const columns = process.stdout.columns ?? 80;
  const room = Math.max(10, columns - 1);
  const shown = text.length > room ? `${text.slice(0, room - 1)}…` : text;
  process.stdout.write(CLEAR_LINE + paint('dim', shown, process.stdout));
}

export function clearStatus(): void {
  if (process.stdout.isTTY !== true) return;
  process.stdout.write(CLEAR_LINE);
}
