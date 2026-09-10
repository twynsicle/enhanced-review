import { Button, Group, NumberInput, Popover, Select, Stack, Text } from '@mantine/core';
import { IconClockPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import type { ReviewTarget } from '@/domain/review/target';
import { firstRunAt } from '@/domain/schedules/cadence';
import { SCHEDULE_CADENCES, type ScheduleCadence } from '@/domain/schedules/schedule';
import { Caption } from '@/web/components/caption';
import { isActionError } from '@/web/lib/action-error';
import { useHydrated } from '@/web/lib/use-hydrated';
import { token } from '@/web/theme/tokens';

const CADENCE_LABEL: Record<ScheduleCadence, string> = {
  hourly: 'Every hour',
  daily: 'Every day',
  weekly: 'Every week',
};

const DEFAULT_HOUR = 9;

/**
 * The composer's second verb. "Start review" runs the selection once;
 * this arms it, so the same picker serves both without a second page.
 *
 * The zone is the browser's own, read after hydration so the server render
 * does not bake the *server's* zone into the form. Until then the preview
 * says nothing rather than a time that would change under the reader.
 */
export function SchedulePopover({ target }: { target: ReviewTarget | null }) {
  const hydrated = useHydrated();
  const fetcher = useFetcher();
  const [opened, setOpened] = useState(false);
  const [cadence, setCadence] = useState<ScheduleCadence>('daily');
  const [hourOfDay, setHourOfDay] = useState(DEFAULT_HOUR);

  const timeZone = hydrated ? new Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const submitting = fetcher.state !== 'idle';
  const failure = isActionError(fetcher.data) ? fetcher.data.message : null;
  const preview =
    hydrated && timeZone
      ? firstRunAt({ cadence, hourOfDay, timeZone }, new Date()).toLocaleString(undefined, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="top-end"
      width={280}
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Button
          onClick={() => setOpened((open) => !open)}
          disabled={!target || !hydrated}
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<IconClockPlus size={16} />}
        >
          Schedule
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <fetcher.Form method="post" action="/schedules">
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="target" value={target ? JSON.stringify(target) : ''} />
          <input type="hidden" name="timeZone" value={timeZone} />
          <input type="hidden" name="hourOfDay" value={String(hourOfDay)} />
          <input type="hidden" name="cadence" value={cadence} />
          <Stack gap={12}>
            <Stack gap={6}>
              <Caption component="label" id="schedule-cadence-label">
                Cadence
              </Caption>
              <Select
                aria-labelledby="schedule-cadence-label"
                value={cadence}
                onChange={(next) => setCadence((next as ScheduleCadence | null) ?? 'daily')}
                data={SCHEDULE_CADENCES.map((value) => ({
                  value,
                  label: CADENCE_LABEL[value],
                }))}
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
                size="sm"
              />
            </Stack>

            {cadence !== 'hourly' && (
              <Stack gap={6}>
                <Caption component="label" id="schedule-hour-label">
                  Hour ({timeZone || 'local'})
                </Caption>
                <NumberInput
                  aria-labelledby="schedule-hour-label"
                  value={hourOfDay}
                  onChange={(next) => setHourOfDay(typeof next === 'number' ? next : DEFAULT_HOUR)}
                  min={0}
                  max={23}
                  clampBehavior="strict"
                  size="sm"
                />
              </Stack>
            )}

            {preview && (
              <Text fz="sm" c={token('muted-foreground')}>
                First run {preview}.
              </Text>
            )}
            {failure && (
              <Text role="alert" fz="sm" c={token('destructive')}>
                {failure}
              </Text>
            )}

            <Group justify="flex-end" gap={8}>
              <Button
                type="button"
                onClick={() => setOpened(false)}
                variant="subtle"
                color="gray"
                size="sm"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!target || submitting} size="sm" radius="xl">
                {submitting ? 'Arming…' : 'Arm schedule'}
              </Button>
            </Group>
          </Stack>
        </fetcher.Form>
      </Popover.Dropdown>
    </Popover>
  );
}
