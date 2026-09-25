import { useEffect } from 'react';
import { sectionHeadingId, type ReaderSection } from '@/report/reader/sections';

const FOCUS_RETRY_FRAMES = 30;

/**
 * Move focus to a section heading so screen readers announce the new
 * section. The heading mounts on the navigation that `onSelect` starts, so
 * this waits a few frames for it rather than assuming it is already there.
 */
function focusHeading(id: string, framesLeft = FOCUS_RETRY_FRAMES): void {
  requestAnimationFrame(() => {
    const heading = document.getElementById(sectionHeadingId(id));
    if (heading) heading.focus();
    else if (framesLeft > 0) focusHeading(id, framesLeft - 1);
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const INTERACTIVE_SELECTOR = 'button, a[href], [role="button"], summary, [contenteditable="true"]';

/**
 * True when focus sits on a control that owns Space itself. Buttons and links
 * activate on keyup, so a `preventDefault()` here would swallow the click —
 * "Re-run", "Show full file", a sidebar chapter and the resize handle would
 * all silently do nothing.
 */
function ownsSpace(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * Keyboard navigation for the chapter reader. `onSelect` drives the URL
 * state a layer up. Bindings walk `sections` — risk where there is an
 * assessment, then the summary, then the chapters — in the order the sidebar
 * lists them:
 *
 *   - `→` / Space     → next section
 *   - `←` / Shift+Spc → previous section
 *   - `Home`          → the summary, the section the reader opens on
 *   - `End`           → last section
 *   - `1`–`9`         → chapter at that number
 *
 * Home targets the summary by id rather than index 0: risk, when there is
 * one, sits ahead of it in the arrow-key cycle to match the sidebar, so the
 * list's first entry is risk, not the section Home is for.
 *
 * The Space bindings step aside when focus is on a button, link or other
 * control that activates on Space; the arrow keys otherwise keep working from
 * a focused control, which is the point of having them. Either way a control
 * that has already called `preventDefault()` on the key keeps it — the two
 * guards cover different cases, since a button activates on Space through the
 * browser without preventing anything on keydown.
 */
export function useNarrativeKeyboard({
  sections,
  activeId,
  onSelect,
}: {
  sections: readonly ReaderSection[];
  activeId: string;
  onSelect: (id: string) => void;
}): void {
  useEffect(() => {
    const activeIndex = sections.findIndex((section) => section.id === activeId);

    function goTo(e: KeyboardEvent, index: number): void {
      const section = sections[index];
      if (!section) return;
      e.preventDefault();
      onSelect(section.id);
      focusHeading(section.id);
    }

    function handler(e: KeyboardEvent): void {
      /*
       * A control that has already claimed this key keeps it. The sidebar's
       * resize handle is why: it is a `separator`, where `←`/`→` are its own
       * documented interaction, so a press did both — widened the column *and*
       * walked to the next section, taking focus with it, which left the
       * second press with nothing to resize.
       *
       * The report roots at a div, so React's delegated listener sits below
       * `document` and the event arrives here already marked. Moving this
       * listener below the root would undo that.
       */
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      // Leave Cmd-/Ctrl-/Alt- combinations to the browser; Shift is Shift+Space.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Space belongs to a focused button/link; the arrows never do.
      if (e.key === ' ' && ownsSpace(e.target)) return;

      if (e.key === 'ArrowRight' || (e.key === ' ' && !e.shiftKey)) {
        /*
         * Both ends are walls. The summary used to sit after the last chapter
         * in this cycle while sitting first in the sidebar, which left `→`
         * from the summary doing nothing at all — a dead key on the section
         * the reader opens on.
         */
        if (activeIndex >= 0 && activeIndex < sections.length - 1) goTo(e, activeIndex + 1);
        else e.preventDefault();
        return;
      }

      if (e.key === 'ArrowLeft' || (e.key === ' ' && e.shiftKey)) {
        if (activeIndex > 0) goTo(e, activeIndex - 1);
        else e.preventDefault();
        return;
      }

      if (e.key === 'Home') {
        goTo(
          e,
          sections.findIndex((section) => section.kind === 'summary'),
        );
        return;
      }

      if (e.key === 'End') {
        goTo(e, sections.length - 1);
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        const wanted = Number.parseInt(e.key, 10);
        const index = sections.findIndex((section) => section.chapterNumber === wanted);
        if (index >= 0) goTo(e, index);
      }
    }

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [sections, activeId, onSelect]);
}
