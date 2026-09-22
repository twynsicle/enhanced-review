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
