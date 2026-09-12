import type { PersistStorage } from 'zustand/middleware';

/**
 * Storage for a preference whose whole value is one word, stored as that word
 * rather than as JSON. `er-layout` has to be raw so the pre-paint script in
 * `root.tsx` can read it without a parser, and the reader's other topbar
 * preferences follow suit: the stored value is then the same string the code
 * switches on, legible in devtools and greppable.
 *
 * `read` is what makes a retired or hand-edited value safe — it maps whatever
 * is in storage onto the current set of stops, so renaming them lands an old
 * value on the default instead of on nothing. Both directions swallow their
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
