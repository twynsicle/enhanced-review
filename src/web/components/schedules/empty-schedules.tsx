import { Button, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { token } from '@/web/theme/tokens';

/** `/schedules` before the viewer has armed anything. */
export function EmptySchedules() {
  return (
    <Stack component="section" align="center" gap={24} maw={672} mx="auto" py={96} ta="center">
      <svg
        width="160"
        height="120"
        viewBox="0 0 160 120"
        aria-hidden
        style={{ color: token('before') }}
      >
        <circle
          cx="80"
          cy="60"
          r="40"
          fill={token('card')}
          stroke={token('border')}
          strokeWidth="2"
        />
        <circle cx="80" cy="60" r="40" fill={token('before-soft')} opacity="0.5" />
        <path d="M80 34 L80 60 L98 70" stroke="currentColor" strokeWidth="3" fill="none" />
        <circle cx="80" cy="60" r="3" fill="currentColor" />
        <path
          d="M120 34 A 44 44 0 0 1 120 86"
          stroke={token('muted-foreground')}
          strokeWidth="2"
          fill="none"
          opacity="0.5"
          strokeDasharray="4 6"
        />
      </svg>
      <Title order={2} fz="xl" fw={600} style={{ letterSpacing: '-0.015em' }}>
        Nothing on the clock.
      </Title>
      <Text maw={448} fz="md" c="dimmed">
        Pick a pull request or branch on the home page, then arm it from the composer. It will be
        reviewed on your cadence without you asking again.
      </Text>
      <Button component={Link} to="/" radius="xl" h={36} px={16}>
        Choose something to watch →
      </Button>
    </Stack>
  );
}
