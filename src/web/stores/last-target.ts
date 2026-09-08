import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The last review target each user composed, persisted incrementally as the
 * composer changes (repo, kind, PR, branch) so a refresh restores the whole
 * composer state (phase-4-plan P4-D10). `prNumber` and `branchRef` are kept
 * side by side so toggling the kind restores the previous pick either way.
 * One store for every user on the device, keyed by user id, under the single
 * `er:last-target` key.
 */
export interface LastTarget {
  repoFullName: string;
  kind: 'pr' | 'branch';
  prNumber?: number;
  branchRef?: string;
}

export const LAST_TARGET_KEY = 'er:last-target';

interface LastTargetState {
  byUser: Record<string, LastTarget>;
  set: (userId: string, target: LastTarget | null) => void;
}

const noopStorage: Storage = {
  length: 0,
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {},
};

export const useLastTarget = create<LastTargetState>()(
  persist(
    (set) => ({
      byUser: {},
      set: (userId, target) =>
        set((state) => {
          const byUser = { ...state.byUser };
          if (target) byUser[userId] = target;
          else delete byUser[userId];
          return { byUser };
        }),
    }),
    {
      name: LAST_TARGET_KEY,
      storage: createJSONStorage(() =>
        typeof window === 'undefined' ? noopStorage : window.localStorage,
      ),
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);

function isLastTarget(value: unknown): value is LastTarget {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<LastTarget>;
  return typeof v.repoFullName === 'string' && (v.kind === 'pr' || v.kind === 'branch');
}

export function readLastTarget(userId: string): LastTarget | null {
  const stored = useLastTarget.getState().byUser[userId];
  if (!isLastTarget(stored)) return null;
  const result: LastTarget = { repoFullName: stored.repoFullName, kind: stored.kind };
  if (typeof stored.prNumber === 'number') result.prNumber = stored.prNumber;
  if (typeof stored.branchRef === 'string') result.branchRef = stored.branchRef;
  return result;
}

function write(userId: string, target: LastTarget | null): void {
  useLastTarget.getState().set(userId, target);
}

export function writeLastRepo(userId: string, repoFullName: string): void {
  const current = readLastTarget(userId);
  if (current?.repoFullName === repoFullName) return;
  // Different repo: drop the per-repo selections, keep the kind toggle.
  write(userId, { repoFullName, kind: current?.kind ?? 'pr' });
}

export function writeLastKind(userId: string, kind: LastTarget['kind']): void {
  const current = readLastTarget(userId);
  if (!current || current.kind === kind) return;
  write(userId, { ...current, kind });
}

export function writeLastPull(userId: string, prNumber: number): void {
  const current = readLastTarget(userId);
  if (!current || current.prNumber === prNumber) return;
  write(userId, { ...current, prNumber });
}

export function writeLastBranch(userId: string, branchRef: string): void {
  const current = readLastTarget(userId);
  if (!current || current.branchRef === branchRef) return;
  write(userId, { ...current, branchRef });
}

export function clearLastPull(userId: string): void {
  const current = readLastTarget(userId);
  if (!current || current.prNumber === undefined) return;
  const { prNumber: _dropped, ...next } = current;
  write(userId, next);
}

export function clearLastBranch(userId: string): void {
  const current = readLastTarget(userId);
  if (!current || current.branchRef === undefined) return;
  const { branchRef: _dropped, ...next } = current;
  write(userId, next);
}

export function clearLastTarget(userId: string): void {
  if (!readLastTarget(userId)) return;
  write(userId, null);
}
