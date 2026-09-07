import { ActionIcon, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * True after hydration, false during SSR and the hydrating render. The stored
 * colour scheme is only known in the browser, so the toggle renders the
 * default (dark) icon until then to keep server and client markup identical.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Dark ⇄ light switch; persists through Mantine's `er-theme` manager (A3). */
export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const hydrated = useHydrated();
  const isDark = hydrated ? colorScheme !== 'light' : true;
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}
