import { useEffect, useState, type RefObject } from 'react';
import { TOPBAR_HEIGHT } from '@/report/theme/tokens';

/**
 * The file whose diff is pinned under the topbar: the last card whose top has
 * passed the topbar's lower edge. Every diff card carries `data-diff-file`,
 * and its header sticks at exactly that line, so this names the file whose
 * header the reader can see — the sidebar's mark and the header agree by
 * construction rather than by two thresholds kept in step.
 *
 * The gap between two cards falls to the card above it, which is what "last
 * one passed" gives for free. Scrolling back above the first card gives null:
 * nothing is being read yet, so nothing is marked.
 */
function pinnedFile(root: HTMLElement): string | null {
  let pinned: string | null = null;
  for (const card of root.querySelectorAll<HTMLElement>('[data-diff-file]')) {
    if (card.getBoundingClientRect().top > TOPBAR_HEIGHT) break;
    pinned = card.dataset.diffFile ?? null;
  }
  return pinned;
}

/**
 * Which file the reader currently has in front of them inside `ref`, so the
 * sidebar can mark it while they scroll a chapter.
 *
 * Positions are re-read rather than watched with an IntersectionObserver
 * because the cards move on their own: a Monaco editor settles its height well
 * after mount, and "Show full file" changes it again on click. A reader who
 * has not touched the wheel can therefore end up in front of a different file,
 * which is why the element is observed for resize as well as the window for
 * scroll. `contentKey` changes when the column is handed different content, so
 * a chapter switch takes the answer again instead of waiting for a scroll that
 * may never come.
 */
export function useReadingFile(
  ref: RefObject<HTMLElement | null>,
  contentKey: string,
): string | null {
  const [file, setFile] = useState<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Coalesced to a frame: scroll fires far faster than the answer can change,
    // and the read is a layout flush per card.
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      setFile(pinnedFile(element));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- contentKey is the trigger, not read in the body
  }, [ref, contentKey]);

  return file;
}
