import { Alert, Box, Button, Code, Flex, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import { Form, redirect } from 'react-router';
import { z } from 'zod';
import { isAllowed } from '@/domain/auth/allowlist.server';
import { userContext } from '@/web/auth/context.server';
import { BrandMark } from '@/web/components/brand-mark';
import { ColorSchemeToggle } from '@/web/components/color-scheme-toggle';
import { parseSearchParams } from '@/web/lib/parse.server';
import { token } from '@/web/theme/tokens';
import type { Route } from './+types/login';

export const meta: Route.MetaFunction = () => [{ title: 'Sign in — enhanced-review' }];

// Unknown values are ignored rather than rejected: this is a hint for a
// banner, not an API input.
const searchSchema = z.object({
  error: z.enum(['oauth']).optional().catch(undefined),
});

/**
 * Public. A signed-in **and** allowed user has no business here and goes
 * home; a signed-in but denied user may keep looking at the form (same rule
 * as the previous proxy).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  if (user && (await isAllowed(user.githubLogin))) throw redirect('/');
  const { error } = parseSearchParams(searchSchema, request);
  return { error: error ?? null };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  return (
    <Box component="main" pos="relative" display="flex" style={{ flexDirection: 'column' }}>
      <Box
        aria-hidden
        pos="absolute"
        inset={0}
        style={{
          zIndex: -1,
          pointerEvents: 'none',
          background: 'radial-gradient(60% 60% at 50% 0%, oklch(1 0 0 / 0.06), transparent 70%)',
        }}
      />
      <Group component="header" justify="flex-end" p={{ base: 'md', sm: 'lg' }}>
        <ColorSchemeToggle />
      </Group>
      <Flex flex={1} align="center" justify="center" px="md" pb={64}>
        <Box w="100%" maw={448}>
          <Stack align="center" gap="lg" ta="center">
            <BrandMark size={48} />
            <Stack gap="xs">
              <Title order={1} fz={{ base: 30, sm: 36 }} style={{ letterSpacing: '-0.015em' }}>
                Enhanced&nbsp;Review
              </Title>
              <Text size="sm" c="dimmed">
                AI code-review that reads like a senior engineer’s walkthrough.
              </Text>
            </Stack>
          </Stack>

          <Paper
            mt={40}
            p={{ base: 'lg', sm: 28 }}
            radius="xl"
            bg={token('card')}
            style={{ boxShadow: `inset 0 0 0 1px ${token('border')}` }}
          >
            <Stack gap="md">
              {loaderData.error === 'oauth' && (
                <Alert color="risk" variant="light" title="Sign-in did not complete">
                  GitHub did not finish the sign-in. Try again.
                </Alert>
              )}
              <Group align="flex-start" gap="sm" wrap="nowrap">
                <IconSparkles
                  size={16}
                  aria-hidden
                  style={{ marginTop: 2, flexShrink: 0, color: token('muted-foreground') }}
                />
                <Text size="sm" c="dimmed">
                  Invite-only beta. Sign in with the GitHub account that’s been added to the
                  allowlist — we’ll need <Code>repo</Code> read scope to fetch diffs.
                </Text>
              </Group>
              <Form method="post" action="/auth/github">
                <Button type="submit" fullWidth radius="xl">
                  Sign in with GitHub
                </Button>
              </Form>
            </Stack>
          </Paper>

          <Text mt="lg" ta="center" size="xs" c="dimmed">
            By signing in you agree to leave us alone if the AI says something silly.
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}
