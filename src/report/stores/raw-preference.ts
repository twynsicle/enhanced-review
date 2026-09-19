import type { PersistStorage } from 'zustand/middleware';

/**
 * Storage for a preference whose whole value is one word, stored as that word
 * rather than as JSON: the stored value is then the same string the code
 * switches on, legible in devtools and greppable. Reads are synchronous, so a
 * store built on it holds the stored value from its first render.
 *
 * `read` is what makes a hand-edited value safe — it maps whatever is in
 * storage onto the current set of stops, so an unknown value lands on the
 * default instead of on nothing. Both directions swallow their
 * errors: in private mode or over quota the preference simply does not stick.
 */
export function rawPreferenceStorage<State>(
  read: (stored: string | null) => State,
  write: (state: State) => string,
): PersistStorage<State> {
  return {
    getItem: (name) => {
      try {
        return { state: read(window.localStorage.getItem(name)) };
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        window.localStorage.setItem(name, write(value.state));
      } catch {
        /* private mode / quota: the preference just does not stick */
      }
    },
    removeItem: (name) => {
      try {
        window.localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}
