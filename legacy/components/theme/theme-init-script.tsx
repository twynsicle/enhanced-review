/**
 * Inline script that runs in <head> BEFORE React hydrates and BEFORE the
 * first paint. Reads `er-theme` from localStorage and toggles the `dark`
 * class on <html> accordingly. Default is dark — only flips to light if
 * the user has previously chosen light mode.
 *
 * Must stay tiny and dependency-free; it executes synchronously in the
 * browser's main thread.
 */
const SCRIPT = `
  try {
    var t = localStorage.getItem('er-theme');
    if (t === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
`;

export function ThemeInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
