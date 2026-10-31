import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunFolder } from '../cli/run-folder.ts';
import { GIT_TEST_TIMEOUT } from '../test/git-repo.ts';
import { DIAGRAM_CONTRIVED_DIR } from './diagram-case.ts';
import {
  diagramSampleFiles,
  readDiagramSweep,
  runDiagramSweep,
  type ReviewRun,
} from './diagram-run.ts';
import { scoreDiagramSweep } from './diagram-score.ts';

// Each sample stands a branch up in real git — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'er-diagram-run-'));
  write(path.join(root, DIAGRAM_CONTRIVED_DIR, 'base', 'src', 'a.ts'), 'export const a = 1;');
  for (const name of ['good', 'bad']) {
    const dir = path.join(root, DIAGRAM_CONTRIVED_DIR, name);
    write(path.join(dir, 'files', 'src', `${name}.ts`), `export const ${name} = true;`);
    write(
      path.join(dir, 'branch.json'),
      JSON.stringify({
        branch: `feat/${name}`,
        title: name,
        description: '',
        commit: { subject: `Add ${name}`, body: '' },
        removed: [],
        expect: {
          overview: null,
          chapterDiagrams: { min: 0, max: 0, kinds: [] },
          mustName: [],
          mustReach: [],
          question: 'What changed?',
        },
      }),
    );
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** er as a stand-in: `good` writes a run folder and exits with a warning, `bad` writes none. */
async function review(cwd: string, asked: ReviewRun) {
  if (path.basename(cwd) !== 'packhouse') throw new Error(`not a packhouse tree: ${cwd}`);
  if (asked.diagramStyle !== 'files') throw new Error(`asked for ${asked.diagramStyle}`);
  if (existsSync(path.join(cwd, 'src', 'bad.ts'))) {
    return { exitCode: 1, output: 'gather  1 file\nerror the model never answered' };
  }
  const run = await createRunFolder(cwd, 'branch-feat-good', new Date());
  await writeFile(run.review, '{}');
  await writeFile(
    run.events,
    [
      JSON.stringify({ ms: 1, type: 'system', subtype: 'init' }),
      JSON.stringify({ ms: 9, type: 'result', subtype: 'success', turns: 3, costUsd: 0.5 }),
    ].join('\n'),
  );
  return { exitCode: 2, output: 'warning one' };
}

describe('runDiagramSweep', () => {
  it('keeps each sample’s run folder and how it ended, a warning exit as a review and a non-zero one without a folder as a failure', async () => {
    const seen: string[] = [];
    const folder = await runDiagramSweep(
      {
        root,
        model: null,
        diagramStyle: 'files',
        samples: 1,
        branches: ['good', 'bad'],
        parallel: 2,
      },
      { review, onSample: (branch, sample) => seen.push(`${branch} ${String(sample)}`) },
    );

    const record = await readDiagramSweep(folder);
    expect(record).toMatchObject({
      model: null,
      diagramStyle: 'files',
      samples: 1,
      branches: ['good', 'bad'],
      costUsd: 0.5,
    });
    expect(Object.keys(record.digests).toSorted()).toEqual(['bad', 'good']);
    expect(record.finishedAt).not.toBeNull();
    expect(seen.toSorted()).toEqual(['bad 1', 'good 1']);

    const good = diagramSampleFiles(folder, 'good', 1);
    expect(JSON.parse(readFileSync(good.meta, 'utf8'))).toMatchObject({
      exitCode: 2,
      costUsd: 0.5,
      turns: 3,
      failure: null,
    });
    expect(readFileSync(path.join(good.run, 'review.json'), 'utf8')).toBe('{}');

    const bad = diagramSampleFiles(folder, 'bad', 1);
    expect(JSON.parse(readFileSync(bad.meta, 'utf8'))).toMatchObject({
      exitCode: 1,
      costUsd: null,
      failure: expect.stringContaining('the model never answered'),
    });
    expect(existsSync(bad.run)).toBe(false);
  });
});

describe('scoreDiagramSweep', () => {
  it('scores a failed sample as a failure, and refuses a sweep whose branch has changed since', async () => {
    const folder = await runDiagramSweep(
      { root, model: null, diagramStyle: 'files', samples: 1, branches: ['bad'], parallel: 1 },
      { review },
    );
    const [score] = await scoreDiagramSweep(folder, root);
    expect(score?.samples).toMatchObject([{ sample: 1, review: null }]);

    write(path.join(root, DIAGRAM_CONTRIVED_DIR, 'bad', 'files', 'src', 'bad.ts'), 'changed');
    await expect(scoreDiagramSweep(folder, root)).rejects.toThrow('bad changed since this sweep');
  });

  it('rescores without complaint when only the expectation changed', async () => {
    const folder = await runDiagramSweep(
      { root, model: null, diagramStyle: 'files', samples: 1, branches: ['bad'], parallel: 1 },
      { review },
    );
    const spec = path.join(root, DIAGRAM_CONTRIVED_DIR, 'bad', 'branch.json');
    const edited = JSON.parse(readFileSync(spec, 'utf8')) as { expect: { question: string } };
    edited.expect.question = 'Something else?';
    writeFileSync(spec, JSON.stringify(edited));
    const [score] = await scoreDiagramSweep(folder, root);
    expect(score?.spec.expect.question).toBe('Something else?');
  });
});
