import { Button, Flex, Paper, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { token } from '@/web/theme/tokens';
import type { Route } from './+types/denied';

export const meta: Route.MetaFunction = () => [{ title: 'Access denied — enhanced-review' }];

/** Public landing page after the gate signs out a non-allowlisted user. */
export default function Denied() {
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
              Access denied
            </Title>
            <Text size="sm" c="dimmed">
              enhanced-review is in invite-only beta. Your GitHub account isn’t on the allowlist
              yet.
            </Text>
          </Stack>
          <Text size="sm" c="dimmed">
            If you think this is a mistake, reach out to the operator who invited you so they can
            add you to the allowlist.
          </Text>
          <Button component={Link} to="/login" variant="default" fullWidth radius="xl">
            Try a different account →
          </Button>
        </Stack>
      </Paper>
    </Flex>
  );
}
