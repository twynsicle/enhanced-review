import { Code, Container, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { BUNDLE_SCHEMA_VERSION } from '@/domain/review/bundle';
import type { EmbeddedBundleResult } from '@/domain/review/bundle-html';

type Problem = Exclude<EmbeddedBundleResult, { ok: true }>;

/**
 * The one shape the report uses to say it cannot show the review, whether the
 * bundle was unreadable or the reader itself threw. Its audience is whoever
 * the review was written for rather than whoever built this tool, so every
 * message names something that reader can actually do.
 */
function ReportMessage({
  title,
  body,
  detail,
}: {
  title: string;
  body: ReactNode;
  detail?: string;
}) {
  return (
    <Container component="main" size={576} w="100%" px={24} py={64}>
      <Stack align="center" gap={24} ta="center">
        <Title order={1} fz="xl" fw={600}>
          {title}
        </Title>
        <Text fz="sm" c="dimmed">
          {body}
        </Text>
        {detail && (
          <Code block ta="left" w="100%" style={{ whiteSpace: 'pre-wrap' }}>
            {detail}
          </Code>
        )}
      </Stack>
    </Container>
  );
}

function copy(problem: Problem): { title: string; body: ReactNode; detail?: string } {
  switch (problem.reason) {
    case 'version-mismatch':
      return {
        title: 'Regenerate this review',
        body: (
          <>
            This report was written for a different version of the reader. Run{' '}
            <Code>er review --from render</Code> in the repository to rebuild it from the saved
            review.
          </>
        ),
        detail: `report schema ${String(problem.found)}, reader schema ${String(BUNDLE_SCHEMA_VERSION)}`,
      };
    case 'invalid':
      return {
        title: "This report's data can't be read",
        body: 'The review embedded in this page does not match the shape the reader expects.',
        detail: problem.message,
      };
    case 'missing':
      return {
        title: 'This page has no review in it',
        body: (
          <>
            It is the report shell on its own. Open a <Code>review.html</Code> written by{' '}
            <Code>er review</Code>, or run <Code>npm run viewer:dev</Code> for the sample.
          </>
        ),
      };
  }
}

/** Shown instead of the reader when the embedded bundle is missing, from another version, or broken. */
export function ReportProblem({ problem }: { problem: Problem }) {
  const { title, body, detail } = copy(problem);
  return <ReportMessage title={title} body={body} detail={detail} />;
}

/**
 * The route's `errorElement`: what a reader sees when the reader itself throws.
 *
 * It takes nothing from the error. A message can carry a path off the machine
 * that raised it and a stack always does, and neither is the reader's to read
 * or act on — React has already put the error in the console for whoever
 * generated the file. Reloading is offered first because a report is a static
 * file with no state behind it: a second attempt costs the reader nothing, and
 * clears anything that only failed once.
 *
 * It also draws no topbar, unlike `ReportProblem`. The header is reader code
 * like any other, so a crash inside it would be thrown again here, and an
 * error element that throws leaves React nothing above it to catch: the reader
 * would get a blank page instead of this one.
 */
export function ReportCrashed() {
  return (
    <ReportMessage
      title="This review can't be displayed"
      body={
        <>
          Something went wrong while drawing this page. Reloading it may fix it. If it does not, ask
          whoever sent you this file to generate it again — the details are in the browser&rsquo;s
          developer console.
        </>
      }
    />
  );
}
