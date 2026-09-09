import { Button, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { token } from '@/web/theme/tokens';

/** `/history` with no jobs at all (the unfiltered view). */
export function EmptyLibrary() {
  return (
    <Stack component="section" align="center" gap={24} maw={672} mx="auto" py={96} ta="center">
      <svg
        width="160"
        height="120"
        viewBox="0 0 160 120"
        aria-hidden
        style={{ color: token('before') }}
      >
        <rect
          x="20"
          y="10"
          width="120"
          height="92"
          rx="6"
          fill={token('card')}
          stroke={token('border')}
        />
        <rect x="32" y="22" width="40" height="6" rx="3" fill="currentColor" opacity="0.85" />
        <rect
          x="32"
          y="36"
          width="96"
          height="3"
          rx="1.5"
          fill={token('muted-foreground')}
          opacity="0.45"
        />
        <rect
          x="32"
          y="44"
          width="84"
          height="3"
          rx="1.5"
          fill={token('muted-foreground')}
          opacity="0.45"
        />
        <rect
          x="32"
          y="52"
          width="92"
          height="3"
          rx="1.5"
          fill={token('muted-foreground')}
          opacity="0.45"
        />
        <rect x="32" y="68" width="96" height="20" rx="3" fill={token('before-soft')} />
        <path d="M32 68 L32 88" stroke="currentColor" strokeWidth="2" />
      </svg>
      <Title order={2} fz="xl" fw={600} style={{ letterSpacing: '-0.015em' }}>
        The library is waiting.
      </Title>
      <Text maw={448} fz="md" c="dimmed">
        When you start your first review, it lives here — every chapter, every insight, every diff,
        written and indexed.
      </Text>
      <Button component={Link} to="/" radius="xl" h={36} px={16}>
        Begin your first review →
      </Button>
    </Stack>
  );
}
