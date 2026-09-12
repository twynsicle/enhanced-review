import { ActionIcon, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useHydrated } from '@/web/lib/use-hydrated';

/**
 * Dark ⇄ light switch; persists through Mantine's `er-theme` manager.
 * The stored scheme is only known in the browser, so the toggle renders the
 * default (dark) icon until hydration to keep server and client markup
 * identical.
 */
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
