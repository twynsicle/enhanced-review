import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Everything that differs by operating system lives here, so the macOS work
 * (docs/local-mode D13) has one file to change: where the tool itself is,
 * where temporary worktrees go, and how a report is opened.
 */

/** The root of this tool's own clone, found from this file's real location. */
export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function toolVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(TOOL_ROOT, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}
