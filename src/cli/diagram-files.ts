import { finding, type Finding } from '../review/findings.ts';
import { isGraphDiagram, type Diagram } from '../review/diagram.ts';
import type { NarrativeReview } from '../review/narrative.ts';
import { treeEntries } from './context.ts';
import type { Shell } from './git.ts';

/**
 * The paths a diagram names outside the change, held to the head commit. The
 * parser lets an unchanged node name any plain path in the repository, since
 * the picture of a change is mostly the code around it, and a folder, since a
 * part of a running system is often several files; only git knows whether
 * that path is a file or a folder there. A folder is written with a trailing
 * "/", which is how the report tells it from a file, so a path that is one
 * gets the slash whichever way the model wrote it. One that is neither loses
 * its filename and keeps its node, as any other grounding the parser drops
 * does.
 */
export interface CheckedDiagramFiles {
  review: NarrativeReview;
  /** One `diagram-part-dropped` note per diagram that lost a filename. */
  dropped: Finding[];
}

export async function checkDiagramFiles(
  review: NarrativeReview,
  headSha: string,
  changed: readonly string[],
  shell: Shell,
): Promise<CheckedDiagramFiles> {
  const inChange = new Set(changed);
  const diagrams = [review.overviewDiagram, ...review.chapters.map((chapter) => chapter.diagram)];
  const outside = [
    ...new Set(
      diagrams
        .flatMap((diagram) => (diagram ? groundedParts(diagram) : []))
        .flatMap((part) => (part.filename && !inChange.has(part.filename) ? [part.filename] : [])),
    ),
  ];
  if (outside.length === 0) return { review, dropped: [] };

  const bare = (filename: string) => (filename.endsWith('/') ? filename.slice(0, -1) : filename);
  // The listing is recursive, so a folder shows as the files under it, and a
  // submodule or a path the agent saw only in its working tree as nothing.
  const tree = await treeEntries(shell, headSha, [...new Set(outside.map(bare))]);
  const resolve = (filename: string): string | undefined => {
    const path = bare(filename);
    if (tree.get(path)?.type === 'blob') return path;
    const folder = `${path}/`;
    return [...tree.keys()].some((key) => key.startsWith(folder)) ? folder : undefined;
  };
  const resolved = new Map(outside.map((filename) => [filename, resolve(filename)]));
  if (outside.every((filename) => resolved.get(filename) === filename)) {
    return { review, dropped: [] };
  }

  const dropped: Finding[] = [];
  const check = (diagram: Diagram | undefined): Diagram | undefined => {
    if (!diagram) return diagram;
    const gone = new Set(
      groundedParts(diagram).flatMap((part) =>
        part.filename && resolved.has(part.filename) && resolved.get(part.filename) === undefined
          ? [part.filename]
          : [],
      ),
    );
    if (gone.size > 0) {
      dropped.push(
        finding(
          'diagram-part-dropped',
          `Diagram ${diagram.id} dropped ${[...gone].join(', ')}, not ${gone.size > 1 ? 'files or folders' : 'a file or folder'} at the head commit.`,
        ),
      );
    }
    const settle = <T extends { filename?: string }>(part: T): T => {
      if (!part.filename || !resolved.has(part.filename)) return part;
      const path = resolved.get(part.filename);
      if (path !== undefined) return { ...part, filename: path };
      const { filename: _gone, ...rest } = part;
      return rest as T;
    };
    return isGraphDiagram(diagram)
      ? { ...diagram, nodes: diagram.nodes.map(settle) }
      : { ...diagram, participants: diagram.participants.map(settle) };
  };

  const overviewDiagram = check(review.overviewDiagram);
  return {
    review: {
      ...review,
      ...(overviewDiagram ? { overviewDiagram } : {}),
      chapters: review.chapters.map((chapter) => {
        const diagram = check(chapter.diagram);
        return diagram ? { ...chapter, diagram } : chapter;
      }),
    },
    dropped,
  };
}

function groundedParts(diagram: Diagram): readonly { filename?: string }[] {
  return isGraphDiagram(diagram) ? diagram.nodes : diagram.participants;
}
