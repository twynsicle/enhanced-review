import { Box, Group, Stack, Text, Title } from '@mantine/core';
import type { Phase, PhaseState } from '@/web/components/jobs/live-phases';
import { token } from '@/web/theme/tokens';
import classes from './job-timeline.module.css';

const MARKER: Record<PhaseState, string> = {
  done: '✓',
  active: '●',
  error: '!',
  pending: '',
  cancelled: '',
};

/** The three-phase timeline of the live view; the module paints the rail and markers. */
export function JobTimeline({ phases }: { phases: Phase[] }) {
  return (
    <ol className={classes.list} aria-live="polite">
      <span aria-hidden className={classes.rail} />
      {phases.map((phase) => (
        <li key={phase.id} className={classes.phase}>
          <span aria-hidden className={classes.marker} data-state={phase.state}>
            {MARKER[phase.state]}
          </span>
          <Group justify="space-between" align="baseline" gap={12} wrap="nowrap">
            <Title order={3} fz="lg" fw={600}>
              {phase.label}
            </Title>
            {phase.stamp && (
              <Text component="span" ff="monospace" fz="xs" c="dimmed">
                {phase.stamp}
              </Text>
            )}
          </Group>
          <Text fz="sm" c="dimmed" style={{ textWrap: 'pretty' }}>
            {phase.detail}
          </Text>
          {phase.titles && phase.titles.length > 0 && (
            <Stack
              gap={4}
              mt={8}
              p={12}
              style={{
                borderRadius: 8,
                border: `1px solid color-mix(in oklab, ${token('before')} 25%, transparent)`,
                background: token('before-soft'),
              }}
            >
              {phase.titles.map((title, i) => (
                <Box
                  key={`${String(i)}:${title.text}`}
                  component="span"
                  fz="sm"
                  fs={title.state === 'active' ? 'italic' : undefined}
                  c={title.state === 'done' ? token('after-ink') : token('muted-foreground')}
                >
                  {title.state === 'done' ? '✓' : '◦'} {title.text}
                  {title.state === 'active' && (
                    <span aria-hidden className={classes.cursor}>
                      ▍
                    </span>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </li>
      ))}
    </ol>
  );
}
