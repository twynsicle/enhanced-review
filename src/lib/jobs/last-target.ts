'use client';

/**
 * Persisted "last review target" the user kicked off, scoped per user so
 * a shared device with multiple GitHub accounts stays sensible. Read on
 * homepage mount to auto-fill the composer; written after a successful
 * `POST /api/jobs`.
 *
 * Stored as JSON. Validation is permissive — anything that doesn't shape
 * up returns null and clears the entry.
 */

export type LastTarget =
  | {
      repoFullName: string;
      kind: 'pr';
      prNumber: number;
    }
  | {
      repoFullName: string;
      kind: 'branch';
      branchRef: string;
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
    if (parsed.kind === 'pr' && typeof parsed.prNumber === 'number') {
      return {
        repoFullName: parsed.repoFullName,
        kind: 'pr',
        prNumber: parsed.prNumber,
      };
    }
    if (parsed.kind === 'branch' && typeof parsed.branchRef === 'string') {
      return {
        repoFullName: parsed.repoFullName,
        kind: 'branch',
        branchRef: parsed.branchRef,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLastTarget(userId: string, target: LastTarget): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY(userId), JSON.stringify(target));
  } catch {
    /* quota / private mode — silently skip */
  }
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
