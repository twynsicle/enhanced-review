import { Box, Group } from '@mantine/core';
import { Link } from 'react-router';
import type { JobStatus } from '@/domain/jobs/status';
import { token } from '@/web/theme/tokens';

export type StatusFilter = JobStatus | 'all';

/** Display order from `main` (lifecycle order, cancelled before error). */
const OPTIONS: StatusFilter[] = ['all', 'pending', 'running', 'done', 'cancelled', 'error'];

/** `/history` status filter — plain links, no client state. */
export function FilterChips({ current }: { current: StatusFilter }) {
  return (
    <Group gap={8}>
      {OPTIONS.map((value) => {
        const active = current === value;
        return (
          <Box
            key={value}
            component={Link}
            to={value === 'all' ? '/history' : `/history?status=${value}`}
            aria-pressed={active}
            px={12}
            py={4}
            fz="sm"
            fw={active ? 600 : undefined}
            style={{
              borderRadius: 999,
              textDecoration: 'none',
              transition: 'background-color 120ms',
              // On the tint, not the page: the `-ink` pair, per the design
              // system rules in AGENTS.md.
              color: active ? token('before-ink') : token('muted-foreground'),
              background: active ? token('before-soft') : token('card'),
              border: active ? '1px solid transparent' : `1px solid ${token('border')}`,
            }}
          >
            {value}
          </Box>
        );
      })}
    </Group>
  );
}
