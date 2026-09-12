/**
 * `1 file`, `2 files`. Every noun this app counts takes a plain `-s`, and the
 * alternative is the same ternary inline at each call site, each free to
 * disagree with the others about spacing or about what `String(count)` looks
 * like.
 */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
