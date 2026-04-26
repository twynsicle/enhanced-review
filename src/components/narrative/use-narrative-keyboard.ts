'use client';

import { useEffect } from 'react';
import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@enhanced-review/review-types';

interface UseNarrativeKeyboardArgs {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Keyboard navigation for the chapter reader. Ported from the diffy POC's
 * `use-narrative-keyboard.ts`, with the Redux dispatch swapped for an
 * `onSelect` callback so the page can drive URL state instead of store
 * state. Bindings:
 *
 *   - `→` / Space     → next chapter (or jump from last chapter to summary)
 *   - `←` / Shift+Spc → previous chapter
 *   - `Home`          → first chapter
 *   - `End`           → summary
 *   - `1`–`9`         → chapter at that index
 *
 * Focus is moved to the chapter heading (`#chapter-heading-<id>`) after a
 * navigation so screen readers announce the new section.
 */
export function useNarrativeKeyboard({
  chapters,
  activeId,
  onSelect,
}: UseNarrativeKeyboardArgs): void {
  useEffect(() => {
    const isSummary = activeId === SUMMARY_SECTION_ID;
    const activeIndex = chapters.findIndex((ch) => ch.id === activeId);

    function focusHeading(id: string): void {
      requestAnimationFrame(() => {
        document.getElementById(`chapter-heading-${id}`)?.focus();
      });
    }

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
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }

      // Ignore when modifier keys other than Shift (used for Shift+Space)
      // are held — leaves Cmd-/Ctrl- combinations to the browser.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

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
        const idx = parseInt(e.key, 10) - 1;
        if (idx < chapters.length) goToChapter(e, idx);
      }
    }

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [chapters, activeId, onSelect]);
}
