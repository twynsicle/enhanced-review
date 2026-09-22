import { localStorageColorSchemeManager } from '@mantine/core';

/**
 * Stored values are `light` | `dark`, which Mantine's manager reads
 * unchanged. The default scheme is dark (`main.tsx`).
 */
export const COLOR_SCHEME_KEY = 'er-theme';

export const colorSchemeManager = localStorageColorSchemeManager({ key: COLOR_SCHEME_KEY });
