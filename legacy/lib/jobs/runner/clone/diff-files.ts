import { runGitOrThrow, type GitRunner } from './git-runner';
import type { PrFileChange, PrFileStatus } from '../prompt/types';

const STATUS_MAP: Record<string, PrFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
  U: 'modified',
};

export async function listChangedFiles(
  runner: GitRunner,
  cwd: string,
  base: string,
  head: string,
  signal?: AbortSignal,
): Promise<PrFileChange[]> {
  const numstat = await runGitOrThrow(runner, 'diff --numstat', {
    args: ['diff', '--numstat', `${base}..${head}`],
    cwd,
    signal,
  });
  const status = await runGitOrThrow(runner, 'diff --name-status', {
    args: ['diff', '--name-status', `${base}..${head}`],
    cwd,
    signal,
  });

  return mergeFileLists(numstat.stdout, status.stdout);
}

export function mergeFileLists(numstatOut: string, nameStatusOut: string): PrFileChange[] {
  const numByFilename = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstatOut.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const additionsRaw = parts[0]!;
    const deletionsRaw = parts[1]!;
    const filename = parts[parts.length - 1]!;
    const additions = additionsRaw === '-' ? 0 : Number.parseInt(additionsRaw, 10) || 0;
    const deletions = deletionsRaw === '-' ? 0 : Number.parseInt(deletionsRaw, 10) || 0;
    numByFilename.set(filename, { additions, deletions });
  }

  const files: PrFileChange[] = [];
  for (const line of nameStatusOut.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0]!.charAt(0).toUpperCase();
    const filename = parts[parts.length - 1]!;
    const counts = numByFilename.get(filename) ?? { additions: 0, deletions: 0 };
    files.push({
      filename,
      status: STATUS_MAP[code] ?? 'modified',
      additions: counts.additions,
      deletions: counts.deletions,
    });
  }
  return files;
}
