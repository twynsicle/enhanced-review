import { Anchor, Container, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { token } from '@/web/theme/tokens';

/** The 404 page for `/jobs/:id` and `/reviews/:id` — an unknown job id. */
export function JobNotFound() {
  return (
    <Container component="main" size={576} w="100%" px={24} py={64}>
      <Stack align="center" gap={24} ta="center">
        <Title order={1} fz={20} fw={600} ff="text">
          Review not found
        </Title>
        <Text fz="sm" c="dimmed">
          This review id doesn’t match any job we know about. It may have been deleted, or the link
          may be wrong.
        </Text>
        <Anchor component={Link} to="/history" fz="sm" fw={500} c={token('primary')}>
          Back to review history →
        </Anchor>
      </Stack>
    </Container>
  );
}
