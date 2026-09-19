import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/review/bundle';
import type { DiffChunk, ResolvedDiffHunk } from '@/review/narrative';

/**
 * The report's committed sample: a small, made-up change to a made-up repo,
 * shaped so one page exercises every state the reader has: an overview
 * diagram, a risk assessment, a chapter diagram, Monaco diffs for a modified,
 * an added and a removed file, a file too large to embed, a line far too long
 * for its column, and a chunk whose file the bundle does not carry. Its paths
 * put a directory between files of its parent (the scheduler's `fixtures`
 * sorts between `cadence.ts` and `index.ts`), the tree view's hardest case to read:
 * a file below the nested directory could belong to either level.
 * `npm run report:dev` renders it by default, so a UI change never needs a
 * Claude run.
 *
 * Hunk spans are written by hand against the contents below, the way the
 * hunk catalog parses git's headers: a zero-length span starts at the line
 * before the change, and git's line 0 becomes 1. The sample test checks that
 * every chunk's file is embedded except the deliberate gap.
 */

const lines = (...rows: string[]) => [...rows, ''].join('\n');

const CADENCE_BASE = lines(
  "import type { Clock } from './clock';",
  '',
  "export type Cadence = 'daily' | 'weekly';",
  '',
  'export interface Schedule {',
  '  repo: string;',
  '  cadence: Cadence;',
  '}',
  '',
  'const DAY_MS = 24 * 60 * 60 * 1000;',
  '',
  'export function intervalMs(cadence: Cadence): number {',
  "  return cadence === 'daily' ? DAY_MS : 7 * DAY_MS;",
  '}',
  '',
  'export function isDue(schedule: Schedule, lastRun: number, clock: Clock): boolean {',
  '  return clock.now() - lastRun >= intervalMs(schedule.cadence);',
  '}',
);

const CADENCE_HEAD = lines(
  "import type { Clock } from './clock';",
  '',
  "export type Cadence = 'hourly' | 'daily' | 'weekly';",
  '',
  'export interface Schedule {',
  '  repo: string;',
  '  cadence: Cadence;',
  '  /** Paused schedules keep their cadence but never come due. */',
  '  paused: boolean;',
  '}',
  '',
  'const HOUR_MS = 60 * 60 * 1000;',
  'const DAY_MS = 24 * HOUR_MS;',
  '',
  'const INTERVALS: Record<Cadence, number> = {',
  '  hourly: HOUR_MS,',
  '  daily: DAY_MS,',
  '  weekly: 7 * DAY_MS,',
  '};',
  '',
  'export function intervalMs(cadence: Cadence): number {',
  '  return INTERVALS[cadence];',
  '}',
  '',
  'export function isDue(schedule: Schedule, lastRun: number, clock: Clock): boolean {',
  '  if (schedule.paused) return false; // a paused schedule keeps its cadence and its last-run stamp, so resuming one never has to recompute anything',
  '  return clock.now() - lastRun >= intervalMs(schedule.cadence);',
  '}',
);

const QUEUE_HEAD = lines(
  "import { isDue, type Schedule } from './cadence';",
  "import type { Clock } from './clock';",
  '',
  'export interface QueuedReview {',
  '  repo: string;',
  '  enqueuedAt: number;',
  '}',
  '',
  '/** Collects every schedule that has come due, oldest run first. */',
  'export function collectDue(',
  '  schedules: readonly Schedule[],',
  '  lastRuns: ReadonlyMap<string, number>,',
  '  clock: Clock,',
  '): QueuedReview[] {',
  '  return schedules',
  '    .filter((s) => isDue(s, lastRuns.get(s.repo) ?? 0, clock))',
  '    .sort((a, b) => (lastRuns.get(a.repo) ?? 0) - (lastRuns.get(b.repo) ?? 0))',
  '    .map((s) => ({ repo: s.repo, enqueuedAt: clock.now() }));',
  '}',
);

const CRON_BASE = lines(
  '// Superseded by src/scheduler: runs every review at 02:00 regardless of cadence.',
  "import { schedule } from 'node-cron';",
  "import { runAllReviews } from '../reviews/run-all';",
  '',
  'export function startNightlyReviews(): void {',
  "  schedule('0 2 * * *', () => {",
  '    void runAllReviews();',
  '  });',
  '}',
);

const SCHEMA_BASE = lines('{', '  "$id": "schedule.schema.json",', '  "type": "object"', '}');

const INDEX_BASE = lines("export { isDue, type Schedule } from './cadence';");

const INDEX_HEAD = lines(
  "export { isDue, type Cadence, type Schedule } from './cadence';",
  "export { collectDue, type QueuedReview } from './queue';",
);

const FAKE_CLOCK_HEAD = lines(
  "import type { Clock } from '../clock';",
  '',
  '/** A clock a test moves by hand, so a cadence can come due without waiting for it. */',
  'export function fakeClock(start = 0): Clock & { advance(ms: number): void } {',
  '  let now = start;',
  '  return {',
  '    now: () => now,',
  '    advance(ms) {',
  '      now += ms;',
  '    },',
  '  };',
  '}',
);

const SCHEDULES_HEAD = lines(
  "import type { Schedule } from '../cadence';",
  '',
  "export const HOURLY: Schedule = { repo: 'acme/api', cadence: 'hourly', paused: false };",
  "export const DAILY: Schedule = { repo: 'acme/web', cadence: 'daily', paused: false };",
  "export const PAUSED: Schedule = { repo: 'acme/docs', cadence: 'weekly', paused: true };",
);

function hunk(
  id: string,
  fileOrder: number,
  original: [number, number],
  modified: [number, number],
): ResolvedDiffHunk {
  return {
    id,
    fileOrder,
    original: { startLine: original[0], lineCount: original[1] },
    modified: { startLine: modified[0], lineCount: modified[1] },
  };
}

/**
 * `[startLine, lineCount]` per side, as git writes a hunk header. A
 * zero-length side names the line the change sits *after*, so a whole-file
 * add or delete is `0, 0` — the position above the first line — not `1, 0`.
 */
const H = {
  cadenceType: hunk('H0001', 0, [3, 1], [3, 1]),
  paused: hunk('H0002', 1, [7, 0], [8, 2]),
  intervals: hunk('H0003', 2, [10, 1], [12, 8]),
  lookup: hunk('H0004', 3, [13, 1], [22, 1]),
  pausedGuard: hunk('H0005', 4, [16, 0], [26, 1]),
  queue: hunk('H0006', 0, [0, 0], [1, 19]),
  cron: hunk('H0007', 0, [1, 9], [0, 0]),
  schema: hunk('H0008', 0, [1, 4], [1, 2400]),
  docs: hunk('H0009', 0, [12, 3], [12, 9]),
  index: hunk('H0010', 0, [1, 1], [1, 2]),
  fakeClock: hunk('H0011', 0, [0, 0], [1, 12]),
  schedules: hunk('H0012', 0, [0, 0], [1, 5]),
};

const chunk = (filename: string, language: string, hunks: ResolvedDiffHunk[]): DiffChunk => ({
  filename,
  language,
  hunks,
});

export const SAMPLE_BUNDLE: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T09:00:00.000Z',
  meta: {
    repo: 'acme/widgets',
    title: 'Add hourly and paused review schedules',
    prNumber: 42,
    baseRefName: 'main',
    headRefName: 'feat/hourly-schedules',
    authorLogin: 'sample-author',
    description:
      'Adds an hourly cadence and a `paused` flag to review schedules, and moves due-date maths into a table.\n\nThe nightly cron job is removed: the scheduler now owns every cadence.',
    stats: null,
  },
  review: {
    prTitle: 'Add hourly and paused review schedules',
    overviewSummary: {
      lede: 'Scheduling moves from one nightly cron job to a cadence table.',
      body: 'A schedule can now run hourly, daily or weekly, and can be paused without losing its cadence. A new queue collects whatever has come due, oldest first.\n\nThe cron job is deleted outright rather than kept behind a flag, so anything else that imported it breaks at build time rather than silently running twice.',
    },
    riskAssessment: {
      score: 3,
      summary: 'Moderate: every scheduled review now goes through new code.',
      rationale:
        'The due-date maths is small and easy to read, but it replaces the only scheduler the product had. A mistake here skips reviews quietly rather than failing loudly.',
      factors: [
        {
          name: 'Replaces the only scheduler',
          impact: 'raises',
          detail: 'The nightly cron job is deleted in the same change that adds its replacement.',
        },
        {
          name: 'Pure functions',
          impact: 'lowers',
          detail: 'isDue and collectDue take a clock, so they are straightforward to test.',
        },
        {
          name: 'Stored schedules',
          impact: 'neutral',
          detail: 'Existing rows need a paused value; the migration is not part of this diff.',
        },
      ],
    },
    /*
     * Each file carries its share of the hunk catalog, as the parse stage
     * attaches it. Two hunks are cited by no chapter on purpose — the widened
     * Cadence union, so `cadence.ts` is discussed only in part, and the whole
     * of `index.ts` — so the file view has leftovers to draw under their own
     * label and the sidebar has files to mark.
     */
    files: [
      {
        filename: 'src/scheduler/cadence.ts',
        status: 'modified',
        additions: 14,
        deletions: 3,
        hunks: [H.cadenceType, H.paused, H.intervals, H.lookup, H.pausedGuard],
      },
      {
        filename: 'src/scheduler/queue.ts',
        status: 'added',
        additions: 19,
        deletions: 0,
        hunks: [H.queue],
      },
      {
        filename: 'src/scheduler/index.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        hunks: [H.index],
      },
      {
        filename: 'src/scheduler/fixtures/fake-clock.ts',
        status: 'added',
        additions: 12,
        deletions: 0,
        hunks: [H.fakeClock],
      },
      {
        filename: 'src/scheduler/fixtures/schedules.ts',
        status: 'added',
        additions: 5,
        deletions: 0,
        hunks: [H.schedules],
      },
      {
        filename: 'src/legacy/cron.ts',
        status: 'removed',
        additions: 0,
        deletions: 9,
        hunks: [H.cron],
      },
      {
        filename: 'src/generated/schedule.schema.json',
        status: 'modified',
        additions: 2398,
        deletions: 2,
        hunks: [H.schema],
      },
      {
        filename: 'docs/scheduling.md',
        status: 'modified',
        additions: 9,
        deletions: 3,
        hunks: [H.docs],
      },
      {
        filename: 'package-lock.json',
        status: 'modified',
        additions: 84,
        deletions: 31,
        skipped: 'built-in',
      },
      {
        filename: 'docs/cadence-states.png',
        status: 'added',
        additions: 0,
        deletions: 0,
        skipped: 'binary',
      },
    ],
    overviewDiagram: {
      id: 'scheduling-shape',
      kind: 'architecture',
      title: 'Who decides when a review runs',
      caption: 'The cadence table and the queue replace the nightly cron job.',
      direction: 'right',
      nodes: [
        { id: 'schedules', label: 'stored schedules', kind: 'data', change: 'modified' },
        {
          id: 'cadence',
          label: 'cadence table',
          kind: 'code',
          change: 'modified',
          filename: 'src/scheduler/cadence.ts',
          hunkIds: ['H0003', 'H0004'],
        },
        {
          id: 'queue',
          label: 'due queue',
          kind: 'code',
          change: 'added',
          filename: 'src/scheduler/queue.ts',
          hunkIds: ['H0006'],
        },
        {
          id: 'cron',
          label: 'nightly cron',
          kind: 'code',
          change: 'removed',
          filename: 'src/legacy/cron.ts',
          hunkIds: ['H0007'],
        },
        { id: 'runner', label: 'review runner', kind: 'code', change: 'unchanged' },
      ],
      edges: [
        { from: 'schedules', to: 'cadence', change: 'unchanged' },
        { from: 'cadence', to: 'queue', label: 'isDue', change: 'added' },
        { from: 'queue', to: 'runner', change: 'added' },
        { from: 'cron', to: 'runner', change: 'removed' },
      ],
    },
    chapters: [
      {
        id: 'cadence-table',
        title: 'Cadence becomes a table',
        description: {
          lede: 'Due-date maths becomes a lookup table instead of a ternary.',
          body: 'That is what makes the third cadence a one-line change rather than another branch.',
        },
        insights: [
          {
            type: 'rationale',
            title: 'A table scales where a ternary does not',
            text: 'INTERVALS is typed as a record over every cadence, so adding a cadence without an interval is a type error.',
          },
          {
            type: 'highlight',
            title: 'Check the hourly interval',
            text: 'Hourly reviews on a busy repo run 24 times as often as before. Worth confirming the runner can take it.',
            filename: 'src/scheduler/cadence.ts',
          },
        ],
        diffChunks: [chunk('src/scheduler/cadence.ts', 'typescript', [H.intervals, H.lookup])],
      },
      {
        id: 'pausing',
        title: 'Pausing and the due queue',
        description: {
          lede: 'A paused schedule keeps its cadence but never comes due.',
          body: 'The new queue asks each schedule whether it is due, then orders the answers oldest first.',
        },
        insights: [
          {
            type: 'context',
            title: 'Paused is checked first',
            text: 'isDue returns early for a paused schedule, so the clock is never read for it.',
          },
          {
            type: 'context',
            title: 'Never-run schedules sort first',
            text: 'A repo with no last run counts as having run at time zero.',
            filename: 'src/scheduler/queue.ts',
          },
        ],
        diffChunks: [
          chunk('src/scheduler/cadence.ts', 'typescript', [H.paused, H.pausedGuard]),
          chunk('src/scheduler/queue.ts', 'typescript', [H.queue]),
          chunk('src/scheduler/fixtures/schedules.ts', 'typescript', [H.schedules]),
          chunk('src/scheduler/fixtures/fake-clock.ts', 'typescript', [H.fakeClock]),
        ],
        diagram: {
          id: 'due-check',
          kind: 'sequence',
          title: 'One pass of the due queue',
          caption:
            'collectDue asks each schedule in turn; a paused one answers without reading the clock.',
          participants: [
            {
              id: 'queue',
              label: 'collectDue',
              kind: 'code',
              change: 'added',
              filename: 'src/scheduler/queue.ts',
            },
            {
              id: 'cadence',
              label: 'isDue',
              kind: 'code',
              change: 'modified',
              filename: 'src/scheduler/cadence.ts',
            },
            { id: 'clock', label: 'Clock', kind: 'external', change: 'unchanged' },
          ],
          steps: [
            {
              type: 'message',
              from: 'queue',
              to: 'cadence',
              label: 'isDue(schedule, lastRun)',
              style: 'call',
              change: 'added',
            },
            {
              type: 'group',
              style: 'alt',
              branches: [
                {
                  label: 'paused',
                  steps: [
                    {
                      type: 'message',
                      from: 'cadence',
                      to: 'queue',
                      label: 'false',
                      style: 'return',
                      change: 'added',
                    },
                  ],
                },
                {
                  label: 'active',
                  steps: [
                    {
                      type: 'message',
                      from: 'cadence',
                      to: 'clock',
                      label: 'now()',
                      style: 'call',
                      change: 'unchanged',
                    },
                    {
                      type: 'message',
                      from: 'cadence',
                      to: 'queue',
                      label: 'due?',
                      style: 'return',
                      change: 'unchanged',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        id: 'clean-up',
        title: 'The cron job goes',
        description: {
          lede: 'The nightly job is deleted rather than disabled.',
          body: 'The generated schema grows the new field alongside it, and the docs change is described but was not captured.',
        },
        insights: [
          {
            type: 'context',
            title: 'Deleted, not flagged off',
            text: 'Anything still importing startNightlyReviews now fails to build.',
          },
        ],
        diffChunks: [
          chunk('src/legacy/cron.ts', 'typescript', [H.cron]),
          chunk('src/generated/schedule.schema.json', 'json', [H.schema]),
          chunk('docs/scheduling.md', 'markdown', [H.docs]),
        ],
      },
    ],
    judgementCalls: [
      {
        title: 'Hourly cadence offered to every repo',
        text: 'INTERVALS exposes hourly to any schedule, and isDue reads the clock per schedule per pass, so a repo on hourly runs 24 reviews a day where nightly ran one. If few repos will choose it, the table is the cheaper shape either way; if most will, the queue does this work 24 times over and wants a cap before the cadence ships.',
        filename: 'src/scheduler/cadence.ts',
        hunkIds: ['H0003', 'H0004'],
      },
      {
        title: 'The cron job is deleted, not disabled',
        text: 'startNightlyReviews is removed outright rather than flagged off, so a rollback of the scheduler leaves nothing running the nightly pass. Whether that matters depends on whether anything outside this repo still calls it — nothing here does — and on whether a bad deploy can be rolled back within a night.',
        filename: 'src/legacy/cron.ts',
        hunkIds: ['H0007'],
      },
    ],
  },
  files: {
    'src/scheduler/cadence.ts': {
      base: { kind: 'content', content: CADENCE_BASE },
      head: { kind: 'content', content: CADENCE_HEAD },
    },
    'src/scheduler/queue.ts': {
      base: { kind: 'absent' },
      head: { kind: 'content', content: QUEUE_HEAD },
    },
    'src/scheduler/index.ts': {
      base: { kind: 'content', content: INDEX_BASE },
      head: { kind: 'content', content: INDEX_HEAD },
    },
    'src/scheduler/fixtures/fake-clock.ts': {
      base: { kind: 'absent' },
      head: { kind: 'content', content: FAKE_CLOCK_HEAD },
    },
    'src/scheduler/fixtures/schedules.ts': {
      base: { kind: 'absent' },
      head: { kind: 'content', content: SCHEDULES_HEAD },
    },
    'src/legacy/cron.ts': {
      base: { kind: 'content', content: CRON_BASE },
      head: { kind: 'absent' },
    },
    'src/generated/schedule.schema.json': {
      base: { kind: 'content', content: SCHEMA_BASE },
      head: { kind: 'too-large' },
    },
  },
};

/** The one chunk file the sample leaves out on purpose, to show the missing-file state. */
export const SAMPLE_MISSING_FILE = 'docs/scheduling.md';
