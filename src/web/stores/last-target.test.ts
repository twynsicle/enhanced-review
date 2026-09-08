import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAST_TARGET_KEY,
  clearLastBranch,
  clearLastPull,
  clearLastTarget,
  readLastTarget,
  useLastTarget,
  writeLastBranch,
  writeLastKind,
  writeLastPull,
  writeLastRepo,
} from './last-target';

const USER = 'user-1';

beforeEach(async () => {
  window.localStorage.clear();
  useLastTarget.setState({ byUser: {} });
  await useLastTarget.persist.rehydrate();
});

describe('last-target store', () => {
  it('starts empty and persists per user', () => {
    expect(readLastTarget(USER)).toBeNull();
    writeLastRepo(USER, 'acme/widgets');
    expect(readLastTarget(USER)).toEqual({ repoFullName: 'acme/widgets', kind: 'pr' });
    expect(readLastTarget('someone-else')).toBeNull();
    expect(window.localStorage.getItem(LAST_TARGET_KEY)).toContain('acme/widgets');
  });

  it('keeps the kind but drops the picks when the repo changes', () => {
    writeLastRepo(USER, 'acme/widgets');
    writeLastKind(USER, 'branch');
    writeLastPull(USER, 12);
    writeLastBranch(USER, 'feature/x');
    expect(readLastTarget(USER)).toEqual({
      repoFullName: 'acme/widgets',
      kind: 'branch',
      prNumber: 12,
      branchRef: 'feature/x',
    });

    writeLastRepo(USER, 'acme/other');
    expect(readLastTarget(USER)).toEqual({ repoFullName: 'acme/other', kind: 'branch' });
  });

  it('clears one pick at a time, or everything', () => {
    writeLastRepo(USER, 'acme/widgets');
    writeLastPull(USER, 7);
    writeLastBranch(USER, 'main');
    clearLastPull(USER);
    expect(readLastTarget(USER)).toEqual({
      repoFullName: 'acme/widgets',
      kind: 'pr',
      branchRef: 'main',
    });
    clearLastBranch(USER);
    expect(readLastTarget(USER)).toEqual({ repoFullName: 'acme/widgets', kind: 'pr' });
    clearLastTarget(USER);
    expect(readLastTarget(USER)).toBeNull();
  });

  it('ignores writes for a user with no stored repo', () => {
    writeLastKind(USER, 'branch');
    writeLastPull(USER, 1);
    writeLastBranch(USER, 'x');
    expect(readLastTarget(USER)).toBeNull();
  });

  it('rejects malformed stored values', () => {
    useLastTarget.setState({
      byUser: { [USER]: { repoFullName: 42, kind: 'pr' } as unknown as never },
    });
    expect(readLastTarget(USER)).toBeNull();
  });
});
