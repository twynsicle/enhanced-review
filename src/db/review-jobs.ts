import { prisma } from './client.ts';
import { type JobStatus, type Prisma } from './generated/client.ts';

/**
 * `review_jobs` repository. Status transitions are conditional updates: each
 * one names the states it may leave from and returns whether a row actually
 * changed, so callers never race each other with read-then-write. JSON
 * columns (`target`) come back untyped — the layering rule keeps db below
 * domain, so `domain/jobs` parses them.
 */
export interface ReviewJobRecord {
  id: string;
  userId: string;
  /** Denormalised from `users` at read time. */
  githubLogin: string;
  target: unknown;
  status: JobStatus;
  headSha: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  errorMessage: string | null;
  riskScore: number | null;
  /** The schedule that launched this job, or null for a manual submit. */
  scheduleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InFlightJob {
  id: string;
  status: 'pending' | 'running';
}

export const TERMINAL_STATUSES: readonly JobStatus[] = ['done', 'error', 'cancelled'];
export const IN_FLIGHT_STATUSES: readonly JobStatus[] = ['pending', 'running'];

const ERROR_MESSAGE_MAX = 500;

const jobSelect = {
  id: true,
  userId: true,
  target: true,
  status: true,
  headSha: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  errorMessage: true,
  riskScore: true,
  scheduleId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { githubLogin: true } },
} satisfies Prisma.ReviewJobSelect;

type JobRow = Prisma.ReviewJobGetPayload<{ select: typeof jobSelect }>;

function toRecord(row: JobRow): ReviewJobRecord {
  const { user, ...rest } = row;
  return { ...rest, githubLogin: user.githubLogin };
}

export interface CreateJobInput {
  userId: string;
  /** A `ReviewTarget`; validated by the caller, stored verbatim. */
  target: Prisma.InputJsonValue;
  headSha: string;
  /** Set by a scheduler tick so the job can say where it came from. */
  scheduleId?: string | null;
}

export async function createJob(input: CreateJobInput): Promise<ReviewJobRecord> {
  const row = await prisma.reviewJob.create({
    data: {
      userId: input.userId,
      target: input.target,
      headSha: input.headSha,
      scheduleId: input.scheduleId ?? null,
      status: 'pending',
    },
    select: jobSelect,
  });
  return toRecord(row);
}

export async function findJobById(id: string): Promise<ReviewJobRecord | null> {
  const row = await prisma.reviewJob.findUnique({ where: { id }, select: jobSelect });
  return row ? toRecord(row) : null;
}

/**
 * The user's newest pending-or-running job when they are at the cap, else
 * null. Count-then-act is not atomic; acceptable for the closed beta.
 */
export async function findInFlightJob(userId: string, cap: number): Promise<InFlightJob | null> {
  const rows = await prisma.reviewJob.findMany({
    where: { userId, status: { in: [...IN_FLIGHT_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    take: cap,
    select: { id: true, status: true },
  });
  if (rows.length < cap) return null;
  const newest = rows[0];
  if (!newest || (newest.status !== 'pending' && newest.status !== 'running')) return null;
  return { id: newest.id, status: newest.status };
}

export interface ListJobsOptions {
  status?: JobStatus;
  limit: number;
}

/** Every user's jobs, newest first (history page, Recent card). */
export async function listJobs(options: ListJobsOptions): Promise<ReviewJobRecord[]> {
  const rows = await prisma.reviewJob.findMany({
    where: options.status ? { status: options.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: options.limit,
    select: jobSelect,
  });
  return rows.map(toRecord);
}

/** Creation timestamps since `since`, newest first (activity sparkline). */
export async function listJobCreatedAtSince(since: Date, limit = 500): Promise<Date[]> {
  const rows = await prisma.reviewJob.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { createdAt: true },
  });
  return rows.map((row) => row.createdAt);
}

/**
 * The user's jobs that reached a terminal status at or after `since`
 * (`updated_at` moves on the terminal transition and never afterwards).
 */
export async function listTerminalJobsSince(
  userId: string,
  since: Date,
): Promise<ReviewJobRecord[]> {
  const rows = await prisma.reviewJob.findMany({
    where: { userId, status: { in: [...TERMINAL_STATUSES] }, updatedAt: { gte: since } },
    orderBy: { updatedAt: 'desc' },
    select: jobSelect,
  });
  return rows.map(toRecord);
}

/** `pending → running`. False when the job was cancelled (or never existed). */
export async function markRunning(id: string, now = new Date()): Promise<boolean> {
  const result = await prisma.reviewJob.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'running', startedAt: now },
  });
  return result.count > 0;
}

export interface FinalizeDoneInput {
  /** A `NarrativeReview`; the caller owns the shape. */
  content: Prisma.InputJsonValue;
  diffTruncated: boolean;
  riskScore: number | null;
}

/**
 * `running → done` plus the `reviews` row, atomically, so a reader that sees
 * `done` always finds the review. False when the job is no longer running
 * (cancelled or timed out meanwhile); nothing is written in that case.
 */
export async function finalizeDone(
  id: string,
  input: FinalizeDoneInput,
  now = new Date(),
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.reviewJob.updateMany({
      where: { id, status: 'running' },
      data: { status: 'done', completedAt: now, riskScore: input.riskScore },
    });
    if (result.count === 0) return false;
    await tx.review.create({
      data: { jobId: id, content: input.content, diffTruncated: input.diffTruncated },
    });
    return true;
  });
}

/** `pending | running → error`. The message is clipped to 500 characters. */
export async function markErrored(id: string, message: string, now = new Date()): Promise<boolean> {
  const result = await prisma.reviewJob.updateMany({
    where: { id, status: { in: [...IN_FLIGHT_STATUSES] } },
    data: { status: 'error', completedAt: now, errorMessage: message.slice(0, ERROR_MESSAGE_MAX) },
  });
  return result.count > 0;
}

/**
 * `pending | running → cancelled`, only for the owner. False for the wrong
 * owner and for a job that is no longer in flight — callers must not tell
 * the two apart (it would leak ownership).
 */
export async function cancelJob(id: string, userId: string, now = new Date()): Promise<boolean> {
  const result = await prisma.reviewJob.updateMany({
    where: { id, userId, status: { in: [...IN_FLIGHT_STATUSES] } },
    data: { status: 'cancelled', cancelledAt: now },
  });
  return result.count > 0;
}

/** Every in-flight job → `error` with `message`; returns how many. Boot-time recovery. */
export async function recoverOrphans(message: string, now = new Date()): Promise<number> {
  const result = await prisma.reviewJob.updateMany({
    where: { status: { in: [...IN_FLIGHT_STATUSES] } },
    data: { status: 'error', completedAt: now, errorMessage: message.slice(0, ERROR_MESSAGE_MAX) },
  });
  return result.count;
}

export function countJobsByStatus(status: JobStatus): Promise<number> {
  return prisma.reviewJob.count({ where: { status } });
}

export async function oldestPendingCreatedAt(): Promise<Date | null> {
  const row = await prisma.reviewJob.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export function countErrorsSince(since: Date): Promise<number> {
  return prisma.reviewJob.count({ where: { status: 'error', completedAt: { gte: since } } });
}
