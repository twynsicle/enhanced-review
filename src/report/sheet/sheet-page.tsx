import { Anchor, Button, Checkbox, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { Caption } from '@/report/chrome/caption';
import { DiagramFigure } from '@/report/diagram/diagram-figure';
import { token } from '@/report/theme/tokens';
import {
  RATINGS,
  type ContactSheet,
  type Rating,
  type SheetBranch,
  type SheetJudgement,
  type SheetSample,
} from './sheet-data';
import { ratingKey, ratingsFile, useSheetRatings } from './sheet-ratings';
import classes from './sheet.module.css';

/**
 * Every diagram of a sweep on one page, a row per branch and a column per
 * sample, beside what the branch deserves and with none of the chapter
 * prose: the question it answers is whether a picture can be understood on
 * its own, so nothing else on the page may explain it. Two sweeps are two
 * bands in each row, the same samples one above the other.
 *
 * Each overview carries the user's rating, which the eval's judges are
 * checked against, and the judges' own verdicts stay hidden until asked for,
 * so the user rates a picture before reading what a judge made of it.
 */
export function SheetPage({
  result,
}: {
  result: { ok: true; sheet: ContactSheet } | { ok: false; message: string };
}) {
  if (!result.ok) {
    return (
      <main className={classes.page}>
        <Text>{result.message}</Text>
      </main>
    );
  }
  return <Sheet sheet={result.sheet} />;
}

function Sheet({ sheet }: { sheet: ContactSheet }) {
  const { sweeps, branches } = sheet;
  const stamps = sweeps.map((sweep) => sweep.stamp);
  const [showJudges, setShowJudges] = useState(false);
  const ratings = useSheetRatings((state) => state.ratings);
  const file = ratingsFile(ratings, stamps);
  const judged = branches.some((branch) =>
    branch.bands.some((band) =>
      band.some((sample) => sample.diagrams.some((item) => item.judgements.length > 0)),
    ),
  );
  return (
    <main className={classes.page}>
      <header className={classes.brief}>
        <Caption tone="before">Diagram sweep</Caption>
        {sweeps.map((sweep) => (
          <Text key={sweep.stamp} fz="sm">
            <Text component="span" ff="monospace" fz="sm">
              {sweep.stamp}
            </Text>{' '}
            {sweep.summary}
          </Text>
        ))}
        <Group gap={16} mt={12}>
          <Button size="sm" disabled={file.ratings.length === 0} onClick={() => download(file)}>
            Download ratings ({file.ratings.length})
          </Button>
          {judged && (
            <Checkbox
              label="Show the judges"
              size="sm"
              checked={showJudges}
              onChange={(event) => setShowJudges(event.currentTarget.checked)}
            />
          )}
        </Group>
        <Text fz="xs" c="dimmed" mt={6}>
          Save the download as ratings.json in each sweep's folder, then run agree on it.
        </Text>
      </header>
      {branches.map((branch) => (
        <BranchRow key={branch.name} branch={branch} stamps={stamps} showJudges={showJudges} />
      ))}
    </main>
  );
}

function download(file: ReturnType<typeof ratingsFile>) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ratings.json';
  link.click();
  URL.revokeObjectURL(url);
}

function BranchRow({
  branch,
  stamps,
  showJudges,
}: {
  branch: SheetBranch;
  stamps: string[];
  showJudges: boolean;
}) {
  return (
    <section className={classes.branch} aria-label={branch.name}>
      <Stack gap={6} className={classes.brief}>
        <Caption tone="before">{branch.name}</Caption>
        <Text fz="lg" fw={600}>
          {branch.title}
        </Text>
        <Text fz="sm">Deserves {branch.deserves}.</Text>
        <Text fz="sm">The overview should answer: {branch.question}</Text>
        {branch.mustName.length > 0 && (
          <ul className={classes.list}>
            {branch.mustName.map((item) => (
              <li key={item}>
                <Text fz="sm" c="dimmed">
                  {item}
                </Text>
              </li>
            ))}
          </ul>
        )}
        {branch.mustReach.length > 0 && (
          <Text fz="sm" c="dimmed">
            Should reach{' '}
            {branch.mustReach.map((file, at) => (
              <span key={file}>
                {at > 0 && ', '}
                <Text component="span" ff="monospace" fz="sm">
                  {file}
                </Text>
              </span>
            ))}
          </Text>
        )}
      </Stack>
      {branch.bands.map((band, at) => (
        <Stack key={stamps[at] ?? at} gap={8}>
          {stamps.length > 1 && <Caption>{stamps[at]}</Caption>}
          <div className={classes.band}>
            {band.map((sample) => (
              <SampleCell
                key={sample.sample}
                sample={sample}
                overview={{ stamp: stamps[at]!, branch: branch.name, sample: sample.sample }}
                showJudges={showJudges}
              />
            ))}
          </div>
        </Stack>
      ))}
    </section>
  );
}

function SampleCell({
  sample,
  overview,
  showJudges,
}: {
  sample: SheetSample;
  /** Where this sample's overview is rated: its sweep, branch and sample. */
  overview: { stamp: string; branch: string; sample: number };
  showJudges: boolean;
}) {
  return (
    <article className={classes.cell} aria-label={`sample ${String(sample.sample)}`}>
      <Stack gap={4}>
        <Group justify="space-between" gap="sm">
          <Caption>Sample {sample.sample}</Caption>
          {sample.href !== null && (
            <Anchor href={sample.href} fz="sm" target="_blank">
              Open the review
            </Anchor>
          )}
        </Group>
        <Text fz="sm" c={sample.onTarget ? undefined : token('risk')}>
          {sample.verdict}
        </Text>
        <Text fz="xs" c="dimmed">
          {sample.figures}
        </Text>
      </Stack>
      {sample.failure !== null && <pre className={classes.failure}>{sample.failure}</pre>}
      {sample.failure === null && sample.diagrams.length === 0 && (
        <Text fz="sm" c="dimmed">
          No diagrams.
        </Text>
      )}
      {sample.diagrams.map(({ where, diagram, judgements }) => (
        <Stack key={`${where}-${diagram.id}`} gap={6}>
          <Caption>{where}</Caption>
          <DiagramFigure diagram={diagram} />
          {where === 'overview' && <RatingControl overview={overview} />}
          {where === 'overview' && showJudges && <Judgements judgements={judgements} />}
        </Stack>
      ))}
    </article>
  );
}

function RatingControl({
  overview,
}: {
  overview: { stamp: string; branch: string; sample: number };
}) {
  const rating = useSheetRatings(
    (state) => state.ratings[ratingKey(overview.stamp, overview.branch, overview.sample)]?.rating,
  );
  const rate = useSheetRatings((state) => state.rate);
  return (
    <Group gap={6} role="group" aria-label="Your rating">
      <Text fz="xs" c="dimmed">
        Your rating
      </Text>
      {RATINGS.map((choice: Rating) => (
        <Button
          key={choice}
          size="xs"
          variant={rating === choice ? 'filled' : 'default'}
          aria-pressed={rating === choice}
          onClick={() => rate(overview, rating === choice ? null : choice)}
        >
          {choice}
        </Button>
      ))}
    </Group>
  );
}

function Judgements({ judgements }: { judgements: SheetJudgement[] }) {
  if (judgements.length === 0) {
    return (
      <Text fz="xs" c="dimmed">
        Not judged.
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      {judgements.map((item) => (
        <Text key={item.judge} fz="xs">
          <Text component="span" ff="monospace" fz="xs">
            {item.judge}
          </Text>{' '}
          <Text component="span" fw={600} fz="xs">
            {item.rating ?? 'unreadable'}
          </Text>
          : {item.reason}
        </Text>
      ))}
    </Stack>
  );
}
