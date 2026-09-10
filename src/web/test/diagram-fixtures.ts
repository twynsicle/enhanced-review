import type { Diagram } from '@/domain/review/diagram';

/**
 * Diagrams the model actually produced, reviewing PR #3 of this repository.
 *
 * Layout is tested against these rather than against invented shapes: the
 * whole reason the fixture pull request exists is that a schema and a
 * renderer designed against imagined input meet real input badly.
 *
 * HAND_BEFORE_AFTER is the exception. No run has produced a beforeAfter
 * diagram yet, so its renderer is the one piece of this built against a shape
 * we invented; that is a known risk and Phase G is where it gets tested.
 */

export const REAL_ARCHITECTURE: Diagram = {
  id: 'scheduler-shape',
  kind: 'architecture',
  edges: [
    {
      to: 'schedulesRoute',
      from: 'composer',
      label: 'POST intent=create',
      change: 'added',
    },
    {
      to: 'schedulesTable',
      from: 'schedulesRoute',
      label: 'insert active schedule',
      change: 'added',
    },
    {
      to: 'tick',
      from: 'schedulerLoop',
      label: 'every SCHEDULER_TICK_MS',
      change: 'added',
    },
    {
      to: 'schedulesTable',
      from: 'tick',
      label: 'claim / complete / fail',
      change: 'added',
    },
    {
      to: 'startReview',
      from: 'tick',
      label: 'launch with machine token',
      change: 'added',
    },
    {
      to: 'github',
      from: 'startReview',
      label: 're-pin head SHA',
      change: 'unchanged',
    },
    {
      to: 'reviewJobs',
      from: 'startReview',
      label: 'createJob(scheduleId)',
      change: 'modified',
    },
  ],
  nodes: [
    {
      id: 'composer',
      kind: 'code',
      group: 'web',
      label: 'Schedule popover',
      change: 'added',
      hunkIds: ['H0061'],
      filename: 'src/web/components/home/schedule-popover.tsx',
    },
    {
      id: 'schedulesRoute',
      kind: 'code',
      group: 'web',
      label: '/schedules route',
      change: 'added',
      hunkIds: ['H0079'],
      filename: 'src/web/routes/schedules.tsx',
    },
    {
      id: 'schedulesTable',
      kind: 'data',
      group: 'data',
      label: 'review_schedules',
      change: 'added',
    },
    {
      id: 'schedulerLoop',
      kind: 'code',
      group: 'domain',
      label: 'scheduler loop',
      change: 'added',
      hunkIds: ['H0050'],
      filename: 'src/domain/schedules/scheduler.server.ts',
    },
    {
      id: 'tick',
      kind: 'code',
      group: 'domain',
      label: 'runSchedulerTick',
      change: 'added',
      hunkIds: ['H0054'],
      filename: 'src/domain/schedules/tick.server.ts',
    },
    {
      id: 'startReview',
      kind: 'code',
      group: 'domain',
      label: 'startReview',
      change: 'modified',
      hunkIds: ['H0042'],
      filename: 'src/domain/jobs/start-review.server.ts',
    },
    {
      id: 'reviewJobs',
      kind: 'data',
      group: 'data',
      label: 'review_jobs',
      change: 'modified',
    },
    {
      id: 'github',
      kind: 'external',
      label: 'GitHub / machine token',
      change: 'unchanged',
    },
  ],
  title: 'How a schedule becomes a review',
  groups: [
    {
      id: 'web',
      label: 'Web',
    },
    {
      id: 'domain',
      label: 'Scheduler domain',
    },
    {
      id: 'data',
      label: 'Data',
    },
  ],
  caption:
    'Shows where the new pieces (composer button, schedules table, tick loop) attach to the existing review path — startReview and review_jobs are touched but not replaced.',
  direction: 'right',
} as Diagram;

export const REAL_STATE: Diagram = {
  id: 'schedule-status-lifecycle',
  kind: 'state',
  edges: [
    {
      to: 'running',
      from: 'active',
      label: 'tick claims',
      change: 'added',
    },
    {
      to: 'active',
      from: 'running',
      label: 'launched / deferred',
      change: 'added',
    },
    {
      to: 'active',
      from: 'running',
      label: 'launch failed (streak < max)',
      change: 'added',
    },
    {
      to: 'failed',
      from: 'running',
      label: 'launch failed (streak = max)',
      change: 'added',
    },
    {
      to: 'paused',
      from: 'active',
      label: 'owner pauses',
      change: 'added',
    },
    {
      to: 'paused',
      from: 'failed',
      label: 'owner pauses',
      change: 'added',
    },
    {
      to: 'active',
      from: 'paused',
      label: 'owner resumes',
      change: 'added',
    },
    {
      to: 'active',
      from: 'failed',
      label: 'owner resumes',
      change: 'added',
    },
  ],
  nodes: [
    {
      id: 'active',
      kind: 'data',
      label: 'active',
      change: 'added',
      initial: true,
    },
    {
      id: 'running',
      kind: 'data',
      label: 'running (claimed)',
      change: 'added',
    },
    {
      id: 'paused',
      kind: 'data',
      label: 'paused',
      change: 'added',
    },
    {
      id: 'failed',
      kind: 'data',
      label: 'failed',
      change: 'added',
    },
  ],
  title: 'Schedule status transitions',
  caption:
    'All four states and transitions are new; the diagram makes clear that `running` only ever returns to `active` or `failed`, never directly to `paused`.',
  direction: 'right',
} as Diagram;

export const REAL_SEQUENCE: Diagram = {
  id: 'tick-sequence',
  kind: 'sequence',
  steps: [
    {
      to: 'tick',
      from: 'loop',
      type: 'message',
      label: 'tick (SCHEDULER_TICK_MS)',
      style: 'call',
      change: 'added',
    },
    {
      to: 'db',
      from: 'tick',
      type: 'message',
      label: 'claim due (active → running)',
      style: 'call',
      change: 'added',
    },
    {
      to: 'start',
      from: 'tick',
      type: 'message',
      label: 'startReview(machine token, scheduleId)',
      style: 'call',
      change: 'added',
    },
    {
      type: 'group',
      label: 'outcome',
      style: 'alt',
      branches: [
        {
          label: 'launched',
          steps: [
            {
              to: 'db',
              from: 'tick',
              type: 'message',
              label: 'completeRun: running → active',
              style: 'return',
              change: 'added',
            },
          ],
        },
        {
          label: 'owner at job cap',
          steps: [
            {
              to: 'db',
              from: 'tick',
              type: 'message',
              label: 'releaseRun: running → active',
              style: 'return',
              change: 'added',
            },
          ],
        },
        {
          label: 'threw',
          steps: [
            {
              to: 'db',
              from: 'tick',
              type: 'message',
              label: 'failRun: running → active | failed',
              style: 'return',
              change: 'added',
            },
          ],
        },
      ],
    },
  ],
  title: 'One scheduler tick',
  caption:
    'Shows the three possible outcomes of a launch attempt side by side — completion, deferral, and failure — which the prose describes but a reviewer benefits from seeing branch off the same call.',
  participants: [
    {
      id: 'loop',
      kind: 'code',
      label: 'scheduler loop',
      change: 'added',
      filename: 'src/domain/schedules/scheduler.server.ts',
    },
    {
      id: 'tick',
      kind: 'code',
      label: 'runSchedulerTick',
      change: 'added',
      filename: 'src/domain/schedules/tick.server.ts',
    },
    {
      id: 'db',
      kind: 'data',
      label: 'review_schedules',
      change: 'added',
    },
    {
      id: 'start',
      kind: 'code',
      label: 'startReview',
      change: 'modified',
      filename: 'src/domain/jobs/start-review.server.ts',
    },
  ],
} as Diagram;

export const HAND_BEFORE_AFTER: Diagram = {
  id: 'boot-order',
  kind: 'beforeAfter',
  title: 'Boot sequence',
  caption: 'Hand-written fixture: releasing orphaned claims is inserted before the loop is armed.',
  direction: 'down',
  nodes: [
    { id: 'recover', label: 'recover orphaned jobs', kind: 'code', change: 'unchanged' },
    { id: 'release', label: 'release orphaned claims', kind: 'code', change: 'added' },
    { id: 'arm', label: 'arm scheduler loop', kind: 'code', change: 'added' },
    { id: 'serve', label: 'serve requests', kind: 'code', change: 'modified' },
    { id: 'legacy', label: 'inline boot check', kind: 'code', change: 'removed' },
  ],
  edges: [
    { from: 'recover', to: 'release', change: 'added' },
    { from: 'release', to: 'arm', change: 'added' },
    { from: 'arm', to: 'serve', change: 'added' },
    { from: 'recover', to: 'legacy', change: 'removed' },
    { from: 'legacy', to: 'serve', change: 'removed' },
  ],
} as Diagram;
