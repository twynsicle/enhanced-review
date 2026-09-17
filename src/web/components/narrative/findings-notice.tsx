import { List, Stack } from '@mantine/core';
import type { Finding } from '@/domain/review/findings';
import { Caption } from '@/web/components/caption';
import { bannerStyle } from '@/web/theme/tokens';

/**
 * What validating this review found, for the person reading it. Only the
 * warnings: a fatal finding fails the review outright, so one can never reach
 * a reader, and a note costs the reader nothing by definition.
 *
 * It sits in the summary, above everything the reviewer said, because every
 * warning here is a reason to trust the rest of the page a little less — a
 * diagram that was dropped, a diff that was too big to show whole — and that
 * is not something to learn after reading it. Nothing to say, nothing drawn:
 * an empty notice would train the eye to skip a full one.
 */
export function FindingsNotice({ findings }: { findings: readonly Finding[] }) {
  const warnings = findings.filter((item) => item.severity === 'warning');
  if (warnings.length === 0) return null;

  return (
    <Stack
      component="section"
      role="status"
      gap={8}
      px={16}
      py={12}
      style={bannerStyle('suggestion')}
    >
      <Caption component="h3" tone="suggestion">
        What this review cost
      </Caption>
      <List fz="sm" spacing={4} withPadding>
        {warnings.map((warning, index) => (
          <List.Item key={`${warning.code}-${String(index)}`}>{warning.message}</List.Item>
        ))}
      </List>
    </Stack>
  );
}
