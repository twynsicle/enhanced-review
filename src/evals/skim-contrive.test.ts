import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BranchSpecSchema } from './contrive.ts';
import { CONTRIVED_DIR, listContrived, stocklineRepo } from './skim-contrive.ts';

describe('stocklineRepo', () => {
  it('is the skim eval’s base under the root', () => {
    const repo = stocklineRepo(path.join('r'));
    expect(repo.base).toBe(path.join('r', 'evals', 'skims', 'contrived', 'base'));
    expect(repo.name).toBe('stockline');
  });
});

describe('the committed branches', () => {
  it('each have a spec that says nothing about being a fixture', async () => {
    const repo = process.cwd();
    const names = await listContrived(repo);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const text = readFileSync(path.join(repo, CONTRIVED_DIR, name, 'branch.json'), 'utf8');
      const spec = BranchSpecSchema.parse(JSON.parse(text));
      expect(`${spec.title}\n${spec.description}\n${spec.commit.body}`).not.toMatch(
        /fixture|contrived|eval|skim|sample|synthetic/i,
      );
    }
  });
});
