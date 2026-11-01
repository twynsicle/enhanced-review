import { Anchor, Button, Checkbox, Group, Stack, Tabs, Text } from '@mantine/core';
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
import { ratingKey, ratingsFile, useSheetRatings, type RatedOverview } from './sheet-ratings';
import classes from './sheet.module.css';

/**
 * Every diagram of a sweep on one page, a tab per branch and its samples
 * down the page, beside what the branch deserves and with none of the
 * chapter prose: the question it answers is whether a picture can be
 * understood on its own, so nothing else on the page may explain it. Two
 * sweeps are two runs of samples in each tab, the earlier first. Down rather
 * than across: a row of samples, each as wide as its widest diagram,
 * scrolled sideways away from the one being read.
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
        {sweeps.map((sweep, at) => (
          <Text key={sweep.stamp} fz="sm">
            {sweeps.length > 1 && `${sweepName(at)}: `}
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
      <Tabs defaultValue={branches[0]?.name ?? null} keepMounted={false}>
        <Tabs.List aria-label="Branch" className={classes.tabs}>
          {branches.map((branch) => (
            <Tabs.Tab key={branch.name} value={branch.name}>
              {branch.name}{' '}
              <Text component="span" fz="xs" c="dimmed">
                {ratedCount(branch, stamps, ratings)}
              </Text>
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {branches.map((branch) => (
          <Tabs.Panel key={branch.name} value={branch.name}>
            <BranchPanel branch={branch} stamps={stamps} showJudges={showJudges} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </main>
  );
}

/** A sweep's name beside its stamp, when the sheet shows two. */
const sweepName = (at: number) => (at === 0 ? 'Earlier sweep' : 'Later sweep');

/** How many of a branch's overviews the user has rated, across every sweep shown. */
function ratedCount(
  branch: SheetBranch,
  stamps: readonly string[],
  ratings: Record<string, RatedOverview>,
): string {
  const keys = branch.bands.flatMap((band, at) =>
    band.flatMap((sample) =>
      sample.diagrams.some((item) => item.where === 'overview')
        ? [ratingKey(stamps[at]!, branch.name, sample.sample)]
        : [],
    ),
  );
  return `${String(keys.filter((key) => key in ratings).length)}/${String(keys.length)} rated`;
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

function BranchPanel({
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
      <Stack gap={8} className={classes.brief}>
        <Text component="h2" fz="xl" fw={600} m={0}>
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
        <Stack key={stamps[at] ?? at} gap={0}>
          {stamps.length > 1 && (
            <Text component="h3" fz="lg" fw={600} m={0} className={classes.sweep}>
              {sweepName(at)}{' '}
              <Text component="span" ff="monospace" fz="sm" c="dimmed">
                {stamps[at]}
              </Text>
            </Text>
          )}
          {band.map((sample) => (
            <SampleSection
              key={sample.sample}
              sample={sample}
              overview={{ stamp: stamps[at]!, branch: branch.name, sample: sample.sample }}
              showJudges={showJudges}
            />
          ))}
        </Stack>
      ))}
    </section>
  );
}

/**
 * One sample down the page: its heading and verdict, then its overview framed
 * together with the user's rating, so the rating reads as the overview's
 * alone, then its chapters' diagrams under a label of their own.
 */
function SampleSection({
  sample,
  overview,
  showJudges,
}: {
  sample: SheetSample;
  /** Where this sample's overview is rated: its sweep, branch and sample. */
  overview: { stamp: string; branch: string; sample: number };
  showJudges: boolean;
}) {
  const drawn = sample.diagrams.find((item) => item.where === 'overview');
  const chapters = sample.diagrams.filter((item) => item.where !== 'overview');
  return (
    <article className={classes.sample} aria-label={`sample ${String(sample.sample)}`}>
      <Stack gap={4} className={classes.brief}>
        <Group gap="md" align="baseline">
          <Text component="h4" fz="lg" fw={600} m={0}>
            Sample {sample.sample}
          </Text>
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
      {sample.failure === null && (
        <Stack gap={8}>
          <Caption>Overview</Caption>
          {drawn ? (
            <div className={classes.overview}>
              <DiagramFigure diagram={drawn.diagram} />
              <RatingControl overview={overview} />
              {showJudges && <Judgements judgements={drawn.judgements} />}
            </div>
          ) : (
            <Text fz="sm" c="dimmed">
              None drawn.
            </Text>
          )}
        </Stack>
      )}
      {chapters.length > 0 && (
        <Stack gap={24}>
          <Caption>Chapter diagrams</Caption>
          {chapters.map(({ where, diagram }) => (
            <Stack key={`${where}-${diagram.id}`} gap={8}>
              <Text fz="sm" fw={600}>
                {where}
              </Text>
              <DiagramFigure diagram={diagram} />
            </Stack>
          ))}
        </Stack>
      )}
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
