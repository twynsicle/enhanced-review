import { useEffect } from 'react';
import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@/domain/review/narrative';

const FOCUS_RETRY_FRAMES = 30;

/**
 * Move focus to a section heading so screen readers announce the new
 * section. The heading mounts on the navigation that `onSelect` starts, so
 * this waits a few frames for it rather than assuming it is already there.
 */
function focusHeading(id: string, framesLeft = FOCUS_RETRY_FRAMES): void {
  requestAnimationFrame(() => {
    const heading = document.getElementById(`chapter-heading-${id}`);
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
 * state a layer up. Bindings:
 *
 *   - `→` / Space     → next chapter (or from the last chapter to the summary)
 *   - `←` / Shift+Spc → previous chapter (or from the summary to the last chapter)
 *   - `Home`          → first chapter
 *   - `End`           → summary
 *   - `1`–`9`         → chapter at that index
 *
 * The Space bindings step aside when focus is on a button, link or other
 * control that activates on Space; the arrow keys keep working from a focused
 * control, which is the point of having them.
 */
export function useNarrativeKeyboard({
  chapters,
  activeId,
  onSelect,
}: {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  onSelect: (id: string) => void;
}): void {
  useEffect(() => {
    const isSummary = activeId === SUMMARY_SECTION_ID;
    const activeIndex = chapters.findIndex((ch) => ch.id === activeId);

    function goToChapter(e: KeyboardEvent, index: number): void {
      if (index < 0 || index >= chapters.length) return;
      const id = chapters[index].id;
      e.preventDefault();
      onSelect(id);
      focusHeading(id);
    }

    function goToSummary(e: KeyboardEvent): void {
      e.preventDefault();
      onSelect(SUMMARY_SECTION_ID);
      focusHeading(SUMMARY_SECTION_ID);
    }

    function handler(e: KeyboardEvent): void {
      if (isTypingTarget(e.target)) return;
      // Leave Cmd-/Ctrl-/Alt- combinations to the browser; Shift is Shift+Space.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Space belongs to a focused button/link; the arrows never do.
      if (e.key === ' ' && ownsSpace(e.target)) return;

      if (e.key === 'ArrowRight' || (e.key === ' ' && !e.shiftKey)) {
        if (isSummary) {
          e.preventDefault();
        } else if (activeIndex < chapters.length - 1) {
          goToChapter(e, activeIndex + 1);
        } else if (activeIndex === chapters.length - 1) {
          goToSummary(e);
        } else {
          e.preventDefault();
        }
        return;
      }

      if (e.key === 'ArrowLeft' || (e.key === ' ' && e.shiftKey)) {
        if (isSummary) {
          if (chapters.length > 0) goToChapter(e, chapters.length - 1);
          else e.preventDefault();
        } else if (activeIndex > 0) {
          goToChapter(e, activeIndex - 1);
        } else {
          e.preventDefault();
        }
        return;
      }

      if (e.key === 'Home') {
        goToChapter(e, 0);
        return;
      }

      if (e.key === 'End') {
        goToSummary(e);
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = Number.parseInt(e.key, 10) - 1;
        if (idx < chapters.length) goToChapter(e, idx);
      }
    }

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [chapters, activeId, onSelect]);
}
