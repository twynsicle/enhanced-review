import { Button, Flex, Paper, Stack, Text, Title } from '@mantine/core';
import { Form } from 'react-router';
import { token } from '@/web/theme/tokens';
import type { Route } from './+types/relink';

export const meta: Route.MetaFunction = () => [{ title: 'Re-link GitHub · enhanced-review' }];

/**
 * Gated. Landing page when the GitHub token cookie is missing or GitHub
 * rejects it. Re-running the OAuth flow refreshes both cookies; GitHub OAuth
 * Apps issue no refresh tokens, so there is nothing to renew silently.
 */
export function loader() {
  return null;
}

export default function Relink() {
  return (
    <Flex component="main" justify="center" p="lg">
      <Paper
        w="100%"
        maw={448}
        p="lg"
        radius="xl"
        bg={token('card')}
        style={{ boxShadow: `inset 0 0 0 1px ${token('border')}` }}
      >
        <Stack gap="md">
          <Stack gap={6}>
            <Title order={2} fz="lg">
              Re-link your GitHub account
            </Title>
            <Text size="sm" c="dimmed">
              Your GitHub access token is no longer valid. This usually means it was revoked, your
              org changed its OAuth policy, or you signed in before we requested the new scope. Sign
              in again to refresh it.
            </Text>
          </Stack>
          <Form method="post" action="/auth/github">
            <Button type="submit" fullWidth radius="xl">
              Re-link GitHub
            </Button>
          </Form>
        </Stack>
      </Paper>
    </Flex>
  );
}
