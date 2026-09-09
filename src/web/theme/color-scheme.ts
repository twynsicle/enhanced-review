import { localStorageColorSchemeManager } from '@mantine/core';

/**
 * localStorage key carried over from the previous app so existing users keep
 * their choice. Stored values are `light` | `dark`, which Mantine's manager
 * reads unchanged. Default scheme is dark (root.tsx).
 */
export const COLOR_SCHEME_KEY = 'er-theme';

export const colorSchemeManager = localStorageColorSchemeManager({ key: COLOR_SCHEME_KEY });
