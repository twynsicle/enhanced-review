import { describe, expect, it } from 'vitest';
import type { ReviewJobRecord } from '../../db/review-jobs.ts';
import { STUB_REVIEW } from '../review/executor/stub-executor.server.ts';
import { parseJob, parseReview } from './jobs.server.ts';

const RECORD: ReviewJobRecord = {
  id: 'job-1',
  userId: 'u',
  githubLogin: 'alice',
  target: {
    kind: 'branch',
    owner: 'o',
    repo: 'r',
    ref: 'f',
    baseRef: 'main',
    headSha: 'h',
    baseSha: 'b',
  },
  status: 'done',
  headSha: 'h',
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  errorMessage: null,
  riskScore: 2,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('parseJob', () => {
  it('narrows the target JSON to a ReviewTarget', () => {
    const job = parseJob(RECORD);
    expect(job.target.kind).toBe('branch');
    expect(job.githubLogin).toBe('alice');
  });

  it('names the job when the stored target is invalid', () => {
    expect(() => parseJob({ ...RECORD, target: { kind: 'pr' } })).toThrow(
      /review_jobs\.target is invalid for job job-1/,
    );
  });
});

describe('parseReview', () => {
  it('narrows the content JSON to a NarrativeReview', () => {
    const review = parseReview({
      id: 'r1',
      jobId: 'job-1',
      content: STUB_REVIEW,
      diffTruncated: false,
      createdAt: new Date(0),
    });
    expect(review.content.prTitle).toBe('Stub review');
    expect(review.diffTruncated).toBe(false);
  });

  it('names the job when the stored content is invalid', () => {
    expect(() =>
      parseReview({
        id: 'r1',
        jobId: 'job-1',
        content: { nope: true },
        diffTruncated: false,
        createdAt: new Date(0),
      }),
    ).toThrow(/reviews\.content is invalid for job job-1/);
  });
});
