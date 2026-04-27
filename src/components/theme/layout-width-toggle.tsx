'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LAYOUT_WIDTHS } from './layout-width-init-script';

const STORAGE_KEY = 'er-layout';

type LayoutMode = 'narrow' | 'wide';

/**
 * Topbar button that flips the page max-width between narrow (default)
 * and wide. Pairs with `LayoutWidthInitScript`, which applies the saved
 * value before paint so reloads don't flash the wrong width. The button
 * itself only handles user-driven flips and the live CSS variable update.
 */
export function LayoutWidthToggle() {
  const [mode, setMode] = useState<LayoutMode>('narrow');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(stored === 'wide' ? 'wide' : 'narrow');
    } catch {
      /* swallowed: storage may be unavailable in private mode */
    }
  }, []);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: LayoutMode = current === 'wide' ? 'narrow' : 'wide';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* swallowed */
      }
      document.documentElement.style.setProperty('--review-max-width', LAYOUT_WIDTHS[next]);
      return next;
    });
  }, []);

  const label = `Switch to ${mode === 'wide' ? 'narrow' : 'wide'} layout`;

  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={label} title={label}>
      {mode === 'wide' ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
    </Button>
  );
}
