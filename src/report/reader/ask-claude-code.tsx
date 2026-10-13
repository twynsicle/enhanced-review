import { ActionIcon, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconTerminal2 } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { token } from '@/report/theme/tokens';

const LABEL = 'Copy a prompt for Claude Code';

const MANUAL_MAX_ROWS = 16;

/** How long the confirmation stays beside the button. */
export const CONFIRMATION_MS = 4000;

/**
 * The deprecated selection copy, for when the clipboard API refuses: a page
 * opened from file:// is a secure context in Chromium, but the write can
 * still be denied, and this path needs no permission.
 */
function copyThroughSelection(text: string): boolean {
  const previous = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return copied;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyThroughSelection(text);
  }
}

type Outcome = 'idle' | 'copied' | 'manual';

/**
 * The chapter header's top row: `label` (the eyebrow) on the left, and on the
 * right a quiet button that copies `prompt` for Claude Code, with what came of
 * it said beside the button. When neither copy works the prompt is shown,
 * selected, for the reader to copy by hand: a copy that fails without a word
 * would send them to Claude Code with whatever the clipboard held before.
 *
 * Keyed by the chapter where it is drawn, so a chapter change clears it.
 */
export function AskClaudeCode({ prompt, label }: { prompt: string; label: ReactNode }) {
  // An object, so a second copy while the first is still confirmed restarts the timer.
  const [status, setStatus] = useState<{ outcome: Outcome }>({ outcome: 'idle' });
  const manualRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (status.outcome !== 'copied') return;
    const timer = window.setTimeout(() => setStatus({ outcome: 'idle' }), CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status.outcome !== 'manual') return;
    manualRef.current?.focus();
    manualRef.current?.select();
  }, [status]);

  const onCopy = async (): Promise<void> => {
    setStatus({ outcome: (await copyText(prompt)) ? 'copied' : 'manual' });
  };

  return (
    <Stack gap={8}>
      {/*
       * The button is taller than the eyebrow, so it sits out of flow: in flow
       * it would push every chapter's title further down than the summary's.
       */}
      <Group pos="relative" align="center" wrap="nowrap">
        {label}
        <Group
          gap={8}
          align="center"
          wrap="nowrap"
          pos="absolute"
          right={0}
          top="50%"
          style={{ transform: 'translateY(-50%)' }}
        >
          <Text component="span" fz="xs" c="dimmed" ta="right" aria-live="polite">
            {status.outcome === 'copied' && 'Copied — paste it into Claude Code in this repository'}
            {status.outcome === 'manual' && 'Couldn’t copy — copy the prompt below by hand'}
          </Text>
          <Tooltip label={LABEL}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={LABEL}
              onClick={() => void onCopy()}
              style={{ color: token('muted-foreground') }}
            >
              <IconTerminal2 size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {/*
       * Inside the reader's own polite region, which would read the whole
       * prompt aloud as it appears; the status beside the button says enough.
       */}
      {status.outcome === 'manual' && (
        <div aria-live="off">
          <Textarea
            ref={manualRef}
            readOnly
            rows={Math.min(prompt.split('\n').length, MANUAL_MAX_ROWS)}
            aria-label="Prompt for Claude Code"
            value={prompt}
            size="xs"
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          />
        </div>
      )}
    </Stack>
  );
}
