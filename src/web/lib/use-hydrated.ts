import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * True after hydration, false during SSR and the hydrating render. Anything
 * that is only known in the browser (stored preferences, `Notification`
 * permission, Monaco) renders its server-safe default until then so the
 * server and client markup stay identical.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
