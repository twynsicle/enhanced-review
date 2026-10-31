import { finding, type Finding } from '../review/findings.ts';
import { isGraphDiagram, type Diagram } from '../review/diagram.ts';
import type { NarrativeReview } from '../review/narrative.ts';
import { treeEntries } from './context.ts';
import type { Shell } from './git.ts';

/**
 * The files a diagram names outside the change, held to the head commit. The
 * parser lets an unchanged node name any plain path in the repository, since
 * the picture of a change is mostly the code around it; only git knows
 * whether that path is a file there. One that is not loses its filename and
 * keeps its node, as any other grounding the parser drops does.
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

  const tree = await treeEntries(shell, headSha, outside);
  // A directory, a submodule or a path the agent saw only in its working tree
  // is not a file the head commit holds.
  const missing = new Set(outside.filter((filename) => tree.get(filename)?.type !== 'blob'));
  if (missing.size === 0) return { review, dropped: [] };

  const dropped: Finding[] = [];
  const check = (diagram: Diagram | undefined): Diagram | undefined => {
    if (!diagram) return diagram;
    const gone = new Set(
      groundedParts(diagram).flatMap((part) =>
        part.filename && missing.has(part.filename) ? [part.filename] : [],
      ),
    );
    if (gone.size === 0) return diagram;
    dropped.push(
      finding(
        'diagram-part-dropped',
        `Diagram ${diagram.id} dropped ${[...gone].join(', ')}, not ${gone.size > 1 ? 'files' : 'a file'} at the head commit.`,
      ),
    );
    const clear = <T extends { filename?: string }>(part: T): T => {
      if (!part.filename || !missing.has(part.filename)) return part;
      const { filename: _gone, ...rest } = part;
      return rest as T;
    };
    return isGraphDiagram(diagram)
      ? { ...diagram, nodes: diagram.nodes.map(clear) }
      : { ...diagram, participants: diagram.participants.map(clear) };
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
