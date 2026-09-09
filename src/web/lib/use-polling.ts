import { useDocumentVisibility } from '@mantine/hooks';
import { useEffect, useRef } from 'react';

/**
 * Fixed-cadence polling that pauses while the tab is hidden. `tick` runs
 * immediately whenever polling becomes active (enable, tab shown, interval
 * change) and then every `intervalMs`. The latest `tick` is always used, so
 * callers may pass a fresh closure on every render.
 */
export function usePolling({
  enabled,
  intervalMs,
  tick,
}: {
  enabled: boolean;
  intervalMs: number;
  tick: () => void;
}): void {
  const visibility = useDocumentVisibility();
  const active = enabled && visibility === 'visible';
  const tickRef = useRef(tick);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!active) return;
    tickRef.current();
    const id = window.setInterval(() => tickRef.current(), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
}
