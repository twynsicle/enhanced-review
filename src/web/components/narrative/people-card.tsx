import { Avatar, Box, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import type { PullReviewer, ReviewerState } from '@/domain/github/types';
import { BrandMark } from '@/web/components/brand-mark';
import { token, type TokenName } from '@/web/theme/tokens';

export interface AiReviewerData {
  durationMs: number | null;
  insightCount: number;
}

const CAPTION = { fz: 10.5, fw: 500, tt: 'uppercase', style: { letterSpacing: '0.16em' } } as const;

/** Author, GitHub reviewers (latest state each) and the AI reviewer's own line. */
export function PeopleCard({
  author,
  reviewers,
  aiReviewer,
}: {
  author: { login: string; avatarUrl: string | null };
  reviewers: PullReviewer[];
  aiReviewer: AiReviewerData;
}) {
  const showAiReviewer = aiReviewer.durationMs !== null || aiReviewer.insightCount > 0;
  const sortedReviewers = reviewers.toSorted(reviewerSort);

  return (
    <Stack
      component="section"
      gap={16}
      p={20}
      style={{
        borderRadius: 12,
        border: `1px solid ${token('border')}`,
        background: token('card'),
      }}
    >
      <Text {...CAPTION} c={token('subtle')}>
        People
      </Text>

      <Stack component="dl" gap={12} m={0} fz={13}>
        <Row label="Author">
          <Person avatarUrl={author.avatarUrl} login={author.login} />
        </Row>

        {sortedReviewers.length > 0 && (
          <Row label="Reviewers" align="start">
            <Stack component="ul" gap={8} m={0} p={0} miw={0} style={{ listStyle: 'none' }}>
              {sortedReviewers.map((reviewer) => (
                <li key={reviewer.login}>
                  <Person
                    avatarUrl={reviewer.avatarUrl}
                    login={reviewer.login}
                    secondary={
                      <Group component="span" gap={6} wrap="nowrap" display="inline-flex">
                        <Text
                          component="span"
                          fz="inherit"
                          fw={500}
                          c={token(reviewerStateTone(reviewer.state))}
                        >
                          {reviewerStateLabel(reviewer.state)}
                        </Text>
                        {reviewer.submittedAt && (
                          <>
                            <Text component="span" fz="inherit" aria-hidden c={token('subtle')}>
                              ·
                            </Text>
                            <span>{formatRelativeTime(reviewer.submittedAt)}</span>
                          </>
                        )}
                      </Group>
                    }
                  />
                </li>
              ))}
            </Stack>
          </Row>
        )}

        {showAiReviewer && (
          <Row label="AI reviewer">
            <Group gap={8} wrap="nowrap" miw={0}>
              <Box
                component="span"
                aria-hidden
                w={24}
                h={24}
                style={{
                  display: 'flex',
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: `1px solid ${token('border')}`,
                  background: token('background'),
                }}
              >
                <BrandMark size={14} />
              </Box>
              <Stack gap={0} miw={0} lh={1.25}>
                <Text fz="inherit" fw={500} truncate>
                  @enhanced-review
                </Text>
                <Text fz={12} c="dimmed" truncate>
                  {formatAiSubLine(aiReviewer)}
                </Text>
              </Stack>
            </Group>
          </Row>
        )}
      </Stack>
    </Stack>
  );
}

function Row({
  label,
  children,
  align = 'center',
}: {
  label: string;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: '5.5rem minmax(0, 1fr)',
        gap: 12,
        alignItems: align,
      }}
    >
      <Text component="dt" {...CAPTION} c={token('subtle')} pt={align === 'start' ? 4 : 0}>
        {label}
      </Text>
      <Box component="dd" m={0} miw={0}>
        {children}
      </Box>
    </Box>
  );
}

function Person({
  avatarUrl,
  login,
  secondary,
}: {
  avatarUrl: string | null;
  login: string;
  secondary?: ReactNode;
}) {
  return (
    <Group gap={8} wrap="nowrap" miw={0}>
      <Avatar
        src={avatarUrl ?? undefined}
        alt=""
        size={24}
        radius="xl"
        fz={10}
        fw={600}
        tt="uppercase"
        style={{ flexShrink: 0 }}
      >
        {login.slice(0, 1)}
      </Avatar>
      <Stack gap={0} miw={0} lh={1.25}>
        <Text fz="inherit" fw={500} truncate>
          @{login}
        </Text>
        {secondary && (
          <Text fz={12} c="dimmed" truncate>
            {secondary}
          </Text>
        )}
      </Stack>
    </Group>
  );
}

function reviewerStateLabel(state: ReviewerState): string {
  switch (state) {
    case 'approved':
      return 'approved';
    case 'changes_requested':
      return 'requested changes';
    case 'commented':
      return 'commented';
    case 'pending':
      return 'requested';
  }
}

function reviewerStateTone(state: ReviewerState): TokenName {
  switch (state) {
    case 'approved':
      return 'praise';
    case 'changes_requested':
      return 'risk';
    case 'commented':
      return 'muted-foreground';
    case 'pending':
      return 'suggestion';
  }
}

const STATE_ORDER: Record<ReviewerState, number> = {
  changes_requested: 0,
  pending: 1,
  commented: 2,
  approved: 3,
};

function reviewerSort(a: PullReviewer, b: PullReviewer): number {
  const order = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (order !== 0) return order;
  return a.login.localeCompare(b.login);
}

const RELATIVE_THRESHOLDS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = then - Date.now();
  const absMs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const { unit, ms } of RELATIVE_THRESHOLDS) {
    if (absMs >= ms) return formatter.format(Math.round(diffMs / ms), unit);
  }
  return 'just now';
}

export function formatAiSubLine({ durationMs, insightCount }: AiReviewerData): string {
  const insightStr = `${insightCount} ${insightCount === 1 ? 'insight' : 'insights'}`;
  if (durationMs === null || durationMs <= 0) return insightStr;
  return `finished in ${formatDuration(durationMs)} · ${insightStr}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
