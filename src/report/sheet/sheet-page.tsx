import { Anchor, Group, Stack, Text } from '@mantine/core';
import { Caption } from '@/report/chrome/caption';
import { DiagramFigure } from '@/report/diagram/diagram-figure';
import { token } from '@/report/theme/tokens';
import type { ContactSheet, SheetBranch, SheetSample } from './sheet-data';
import classes from './sheet.module.css';

/**
 * Every diagram of a sweep on one page, a row per branch and a column per
 * sample, beside what the branch deserves and with none of the chapter
 * prose: the question it answers is whether a picture can be understood on
 * its own, so nothing else on the page may explain it. Two sweeps are two
 * bands in each row, the same samples one above the other.
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
  const { sweeps, branches } = result.sheet;
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
      </header>
      {branches.map((branch) => (
        <BranchRow key={branch.name} branch={branch} stamps={sweeps.map((sweep) => sweep.stamp)} />
      ))}
    </main>
  );
}

function BranchRow({ branch, stamps }: { branch: SheetBranch; stamps: string[] }) {
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
              <SampleCell key={sample.sample} sample={sample} />
            ))}
          </div>
        </Stack>
      ))}
    </section>
  );
}

function SampleCell({ sample }: { sample: SheetSample }) {
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
      {sample.diagrams.map(({ where, diagram }) => (
        <Stack key={`${where}-${diagram.id}`} gap={6}>
          <Caption>{where}</Caption>
          <DiagramFigure diagram={diagram} />
        </Stack>
      ))}
    </article>
  );
}
