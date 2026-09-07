import {
  Anchor,
  Badge,
  Button,
  Code,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { Form } from 'react-router';
import { userContext } from '@/web/auth/context.server';
import { ColorSchemeToggle } from '@/web/components/color-scheme-toggle';
import { TOKEN_NAMES, token } from '@/web/theme/tokens';
import type { Route } from './+types/skeleton';

/**
 * Placeholder index route for the migration skeleton: a theme showcase used
 * to eyeball fonts, radii and palette against the Phase 0 baselines. Gated,
 * so it doubles as the "you are signed in" page until Phase 4 replaces it
 * with the real home.
 */
export function loader({ context }: Route.LoaderArgs) {
  return { user: context.get(userContext) };
}

export default function Skeleton({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} tt="uppercase" style={{ letterSpacing: '0.14em' }} c="iris">
            ❖ Migration skeleton
          </Text>
          <Group gap="xs">
            {user && (
              <Text size="sm" c="dimmed">
                Signed in as @{user.githubLogin}
              </Text>
            )}
            <Form method="post" action="/auth/logout">
              <Button type="submit" variant="subtle" color="gray" size="xs">
                Sign out
              </Button>
            </Form>
            <ColorSchemeToggle />
          </Group>
        </Group>

        <Stack gap="xs">
          <Title order={1}>The reviewer is ready when you are.</Title>
          <Title order={2}>Every review, indexed.</Title>
          <Title order={3}>Recent</Title>
          <Text>
            Choose a pull request or branch — we’ll read every line, write the chapters, and surface
            the few things that genuinely need a human eye.
          </Text>
          <Text c="dimmed" size="sm">
            @twynsicle · 2m ago · <Code>ecf6327</Code>
          </Text>
          <Anchor href="#">View running review →</Anchor>
        </Stack>

        <Paper withBorder p="lg" radius="lg">
          <Stack gap="md">
            <Text fw={600}>Buttons</Text>
            <Group>
              <Button>Start review</Button>
              <Button variant="light">Rerun</Button>
              <Button variant="outline">Cancel</Button>
              <Button variant="subtle">Sign out</Button>
              <Button color="risk">Delete</Button>
              <Button color="mint" variant="light">
                Approve
              </Button>
            </Group>
            <Text fw={600}>Status badges</Text>
            <Group>
              <Badge variant="light" color="iris">
                running
              </Badge>
              <Badge variant="light" color="mint">
                done
              </Badge>
              <Badge variant="light" color="gray">
                cancelled
              </Badge>
              <Badge variant="light" color="risk">
                error
              </Badge>
              <Badge variant="light" color="suggestion">
                pending
              </Badge>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="lg" radius="lg">
          <Text fw={600} mb="md">
            Semantic tokens
          </Text>
          <Group gap="xs">
            {TOKEN_NAMES.map((name) => (
              <Group key={name} gap={6} wrap="nowrap">
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: token(name),
                    border: `1px solid ${token('border')}`,
                  }}
                />
                <Text size="xs" ff="monospace">
                  {name}
                </Text>
              </Group>
            ))}
          </Group>
        </Paper>
      </Stack>
    </Container>
  );
}
