import type { JobStatus } from '@/domain/jobs/status';
import type { ChapterTitleSnapshot } from '@/domain/review/partial-narrative-parse';
import type { ReviewTarget } from '@/domain/review/target';

/**
 * The live view's three logical phases, derived from the job row and the
 * streamed chunks (ported from `main`): Setting up (pending) → Reading the
 * diff (running, no chunks yet) → Composing the narrative (running with
 * chunks). Pure so the mapping is unit-tested without React.
 */
export type PhaseState = 'done' | 'active' | 'pending' | 'error' | 'cancelled';

export interface PhaseTitle {
  state: 'done' | 'active';
  text: string;
}

export interface Phase {
  id: string;
  label: string;
  detail: string;
  state: PhaseState;
  /** Chapter titles streamed so far, shown only while this phase is active. */
  titles?: PhaseTitle[];
  /** Stamp in the right gutter, e.g. "12s", "now" or "✓". */
  stamp?: string;
}

export function derivePhases(args: {
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  chunkCount: number;
  snapshot: ChapterTitleSnapshot;
}): Phase[] {
  const { status, startedAt, completedAt, chunkCount, snapshot } = args;

  const setupState: PhaseState = status === 'pending' ? 'active' : 'done';
  const readingState: PhaseState =
    status === 'pending' ? 'pending' : status === 'running' && chunkCount === 0 ? 'active' : 'done';
  const writingState = writingStateFor(status, chunkCount);

  const streaming = status === 'pending' || status === 'running';
  const finished = streaming
    ? snapshot.titles
    : [...snapshot.titles, ...(snapshot.inProgressTitle ? [snapshot.inProgressTitle] : [])];
  const titles: PhaseTitle[] = finished.map((text) => ({ state: 'done', text }));
  if (streaming && snapshot.inProgressTitle) {
    titles.push({ state: 'active', text: snapshot.inProgressTitle });
  }

  const totalSec =
    startedAt && completedAt
      ? Math.max(
          0,
          Math.floor((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000),
        )
      : null;

  return [
    {
      id: 'setup',
      label: 'Setting up',
      detail: 'Cloning the repo and starting the reviewer.',
      state: setupState,
      stamp: setupState === 'active' ? 'now' : '✓',
    },
    {
      id: 'reading',
      label: 'Reading the diff',
      detail:
        readingState === 'done'
          ? 'Read.'
          : readingState === 'active'
            ? 'Mapping changed files…'
            : 'Pending — starts once the clone settles.',
      state: readingState,
      stamp: readingState === 'active' ? 'now' : undefined,
    },
    {
      id: 'writing',
      label: 'Composing the narrative',
      detail: writingPhaseDetail(writingState, chunkCount, titles.length),
      state: writingState,
      titles: writingState === 'active' ? titles : undefined,
      stamp:
        writingState === 'done' && totalSec !== null
          ? `${String(totalSec)}s`
          : writingState === 'active'
            ? 'now'
            : undefined,
    },
  ];
}

function writingStateFor(status: JobStatus, chunkCount: number): PhaseState {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return chunkCount > 0 ? 'active' : 'pending';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
  }
}

function writingPhaseDetail(state: PhaseState, chunkCount: number, titleCount: number): string {
  const chapters = `${String(titleCount)} chapter${titleCount === 1 ? '' : 's'}`;
  switch (state) {
    case 'pending':
      return 'Pending — starts when reading settles.';
    case 'active':
      return titleCount === 0 ? 'Streaming chapter titles…' : `${chapters} so far.`;
    case 'done':
      if (titleCount > 0) return `${chapters} finalized.`;
      return chunkCount > 0 ? 'Review complete.' : 'Review complete. Open it when ready.';
    case 'error':
      return 'Streaming halted — see error below.';
    case 'cancelled':
      return chunkCount > 0 ? 'Cancelled · partial output preserved.' : 'Cancelled.';
  }
}

export function phaseEyebrow(status: JobStatus): string {
  if (status === 'done') return 'Review complete';
  if (status === 'error') return 'Review errored';
  if (status === 'cancelled') return 'Review cancelled';
  return 'Composing your review';
}

export function phaseHeading(status: JobStatus, target: ReviewTarget): string {
  const title = target.kind === 'pr' ? target.title : target.ref;
  return status === 'done' ? `Read ${title}` : `Reading ${title}`;
}
