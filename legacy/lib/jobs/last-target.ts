'use client';

/**
 * Persisted "last review target" the user kicked off, scoped per user so
 * a shared device with multiple GitHub accounts stays sensible. Persisted
 * incrementally as the user changes selections (repo, kind toggle, PR,
 * branch) so a refresh restores the full composer state, not just the
 * last submitted job. `prNumber` and `branchRef` are stored side-by-side
 * so toggling the kind in either direction restores the previous pick.
 */

export type LastTarget = {
  repoFullName: string;
  kind: 'pr' | 'branch';
  prNumber?: number;
  branchRef?: string;
};

const KEY = (userId: string) => `er:last-target:${userId}`;

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastTarget(userId: string): LastTarget | null {
  const storage = safeStorage();
  if (!storage) return null;
  const raw = storage.getItem(KEY(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastTarget>;
    if (!parsed || typeof parsed.repoFullName !== 'string') return null;
    if (parsed.kind !== 'pr' && parsed.kind !== 'branch') return null;
    const result: LastTarget = {
      repoFullName: parsed.repoFullName,
      kind: parsed.kind,
    };
    if (typeof parsed.prNumber === 'number') result.prNumber = parsed.prNumber;
    if (typeof parsed.branchRef === 'string') result.branchRef = parsed.branchRef;
    return result;
  } catch {
    return null;
  }
}

function write(userId: string, target: LastTarget): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY(userId), JSON.stringify(target));
  } catch {
    /* quota / private mode — silently skip */
  }
}

export function writeLastRepo(userId: string, repoFullName: string): void {
  const current = readLastTarget(userId);
  if (current?.repoFullName === repoFullName) return;
  // Different repo — drop the per-repo selections, keep the kind toggle.
  write(userId, { repoFullName, kind: current?.kind ?? 'pr' });
}

export function writeLastKind(userId: string, kind: 'pr' | 'branch'): void {
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
  const next = { ...current };
  delete next.prNumber;
  write(userId, next);
}

export function clearLastBranch(userId: string): void {
  const current = readLastTarget(userId);
  if (!current || current.branchRef === undefined) return;
  const next = { ...current };
  delete next.branchRef;
  write(userId, next);
}

export function clearLastTarget(userId: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(KEY(userId));
  } catch {
    /* ignore */
  }
}
