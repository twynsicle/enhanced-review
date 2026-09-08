import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../test/db.ts';
import { prisma } from './client.ts';
import { insertChunk, listChunksAfter } from './review-chunks.ts';
import { createJob } from './review-jobs.ts';
import { upsertUserFromGithub } from './users.ts';

async function makeJob() {
  const user = await upsertUserFromGithub({
    githubId: 1n,
    githubLogin: 'alice',
    name: null,
    avatarUrl: null,
  });
  return createJob({ userId: user.id, target: { kind: 'branch' }, headSha: 'head' });
}

describeDb('review-chunks repository', () => {
  beforeEach(resetDb);

  it('stores seq 0 and returns chunks in order', async () => {
    const job = await makeJob();
    await insertChunk(job.id, 1, 'second');
    await insertChunk(job.id, 0, 'first');
    await insertChunk(job.id, 2, 'third');

    const all = await listChunksAfter(job.id);
    expect(all.map((c) => [c.seq, c.content])).toEqual([
      [0, 'first'],
      [1, 'second'],
      [2, 'third'],
    ]);
    expect(all[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('returns only chunks after the given seq', async () => {
    const job = await makeJob();
    for (let seq = 0; seq < 4; seq += 1) await insertChunk(job.id, seq, `c${String(seq)}`);
    const tail = await listChunksAfter(job.id, 1);
    expect(tail.map((c) => c.seq)).toEqual([2, 3]);
    await expect(listChunksAfter(job.id, 3)).resolves.toEqual([]);
  });

  it('rejects a duplicate seq and a negative seq', async () => {
    const job = await makeJob();
    await insertChunk(job.id, 0, 'a');
    await expect(insertChunk(job.id, 0, 'b')).rejects.toThrow(/unique constraint/i);
    await expect(insertChunk(job.id, -1, 'c')).rejects.toThrow(/check constraint/i);
  });

  it('cascades when the job is deleted', async () => {
    const job = await makeJob();
    await insertChunk(job.id, 0, 'a');
    await prisma.reviewJob.delete({ where: { id: job.id } });
    await expect(prisma.reviewChunk.count()).resolves.toBe(0);
  });
});
