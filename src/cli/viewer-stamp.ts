import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A hash of everything the report viewer is built from.
 * The viewer build writes it beside `viewer.html`; the render stage compares
 * it with the sources in the tool's clone and rebuilds when they differ, so a
 * `git pull` of this tool never renders with a stale viewer. Tests are left
 * out: they change nothing in the build.
 */
export const VIEWER_STAMP_FILE = 'viewer.stamp';

const SOURCES = [
  'src/web',
  'src/domain',
  'vite.viewer.config.ts',
  'tsconfig.json',
  'package-lock.json',
];
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

export function viewerSourceStamp(root: string): string {
  const hash = createHash('sha256');
  for (const file of sourceFiles(root)) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(path.join(root, file)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const source of SOURCES) {
    const full = path.join(root, source);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isDirectory()) {
      files.push(source);
      continue;
    }
    for (const entry of readdirSync(full, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/');
      if (!TEST_FILE.test(file)) files.push(file);
    }
  }
  return files.toSorted();
}
