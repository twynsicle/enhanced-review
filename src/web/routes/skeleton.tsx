import { Container, Text, Title } from '@mantine/core';

/**
 * Placeholder index route for the migration skeleton. Phase 1 commit 2 turns
 * this into the theme showcase used to eyeball the Mantine port against the
 * Phase 0 baselines; Phase 4 replaces it with the real home page.
 */
export default function Skeleton() {
  return (
    <Container size="sm" py="xl">
      <Title order={1}>enhanced-review</Title>
      <Text mt="sm" c="dimmed">
        Migration skeleton. The app is being re-platformed; see docs/rr-migration/.
      </Text>
    </Container>
  );
}
