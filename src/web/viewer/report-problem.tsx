import { Code, Container, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { BUNDLE_SCHEMA_VERSION } from '@/domain/review/bundle';
import type { EmbeddedBundleResult } from '@/domain/review/bundle-html';

type Problem = Exclude<EmbeddedBundleResult, { ok: true }>;

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
