import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * The reader's `?ch=` / `?file=` state, kept in the hash (`#/?ch=…`) because
 * the report is opened from `file://`, where the query string belongs to the
 * file on disk. Each change is a history entry, so back and forward walk the
 * sections the reader visited.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
}

const currentHash = () => window.location.hash;

function paramsOf(hash: string): URLSearchParams {
  const query = hash.indexOf('?');
  return new URLSearchParams(query === -1 ? '' : hash.slice(query + 1));
}

export function useHashParams(): [URLSearchParams, (next: URLSearchParams) => void] {
  const hash = useSyncExternalStore(subscribe, currentHash);
  const params = useMemo(() => paramsOf(hash), [hash]);
  // `pushState` fires no event of its own, so the listeners are told directly.
  const setParams = useCallback((next: URLSearchParams) => {
    const query = next.toString();
    window.history.pushState(null, '', query === '' ? '#/' : `#/?${query}`);
    for (const listener of listeners) listener();
  }, []);
  return [params, setParams];
}
