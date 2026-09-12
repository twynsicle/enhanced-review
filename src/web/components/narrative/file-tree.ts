import type { ReviewFile } from '@/domain/review/narrative';

/**
 * Turning the reviewed files into the directory tree the sidebar's tree view
 * draws. It is a pure function so the shape of the tree can be argued about in
 * a test rather than inferred from rendered indentation.
 *
 * The one non-obvious rule is chain collapsing: a directory whose only entry is
 * another directory is folded into it, so `src/web/components` is one row
 * rather than three nested ones. The sidebar is 208–420px wide and every level
 * of indentation is width taken from the filenames, which are the part a reader
 * is actually scanning; a level that offers no choice — nothing to fold away
 * but the level below, nothing to compare it against — is not worth that width.
 * A directory holding a single *file* is not collapsed, because folding it
 * would turn a directory row into a file row and the reader would have no way
 * to tell the two apart.
 */

export interface FileTreeFile {
  kind: 'file';
  /** The last path segment: what the row shows, the tree carrying the rest. */
  name: string;
  file: ReviewFile;
}

export interface FileTreeDirectory {
  kind: 'directory';
  /** The label, which is several segments deep when a chain was collapsed. */
  name: string;
  /** Full path from the repo root — unique, so it keys both React and the fold state. */
  path: string;
  children: readonly FileTreeNode[];
}

export type FileTreeNode = FileTreeDirectory | FileTreeFile;

/** A directory under construction: insertion order in `entries`, lookup in `byName`. */
interface Level {
  kind: 'directory';
  name: string;
  path: string;
  entries: (Level | FileTreeFile)[];
  byName: Map<string, Level>;
}

function newLevel(name: string, path: string): Level {
  return { kind: 'directory', name, path, entries: [], byName: new Map() };
}

/**
 * Empty segments are dropped, so a leading, trailing or doubled separator names
 * the same node as the tidy spelling of the path. Nothing here ever produces
 * one, but a filename arrives from a review the model wrote, and a blank row
 * with a blank child under it is a worse answer than ignoring the typo. A
 * trailing separator is the one spelling that costs something: `src/` loses its
 * last segment and draws a *file* row named `src`. Git never emits it.
 */
function segmentsOf(filename: string): string[] {
  return filename.split('/').filter((segment) => segment.length > 0);
}

/**
 * Files in, roots out. Entries keep the order the files arrived in — the
 * caller sorts by full path — so the tree reads down in the same order as the
 * flat list and switching between the two never re-orders the same files. That
 * last part holds only while the caller's sort keeps a directory contiguous,
 * and `localeCompare` ignores case and punctuation at primary strength, so
 * sibling `A/` and `a/` can interleave in the flat list where the tree groups
 * them. Cosmetic: no file is lost or duplicated either way.
 *
 * A directory and a file may share a name at one level (`a` beside `a/b.ts`);
 * both survive as separate entries, which is why directories are looked up in
 * a map of their own rather than by scanning `entries`.
 */
export function buildFileTree(files: readonly ReviewFile[]): readonly FileTreeNode[] {
  const root = newLevel('', '');

  for (const file of files) {
    const segments = segmentsOf(file.filename);
    // A path that is nothing but separators leaves no segment to label a row
    // with, and the filename as given is then the only honest thing to show.
    const basename = segments.pop() ?? file.filename;

    let level = root;
    let path = '';
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`;
      let child = level.byName.get(segment);
      if (child === undefined) {
        child = newLevel(segment, path);
        level.byName.set(segment, child);
        level.entries.push(child);
      }
      level = child;
    }
    level.entries.push({ kind: 'file', name: basename, file });
  }

  return finalise(root.entries);
}

function finalise(entries: readonly (Level | FileTreeFile)[]): readonly FileTreeNode[] {
  return entries.map((entry) => (entry.kind === 'file' ? entry : collapse(entry)));
}

/** The directory row this level becomes, having absorbed any chain below it. */
function collapse(level: Level): FileTreeDirectory {
  let deepest = level;
  let name = level.name;
  for (;;) {
    const only = deepest.entries.length === 1 ? deepest.entries[0] : undefined;
    if (only === undefined || only.kind === 'file') break;
    deepest = only;
    name = `${name}/${only.name}`;
  }
  return { kind: 'directory', name, path: deepest.path, children: finalise(deepest.entries) };
}

/** Every file the tree holds, depth first — the tree's reading order. */
export function fileTreeFiles(nodes: readonly FileTreeNode[]): ReviewFile[] {
  return nodes.flatMap((node) =>
    node.kind === 'file' ? [node.file] : fileTreeFiles(node.children),
  );
}
