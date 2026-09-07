import {
  ActionIcon,
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
  useMantineColorScheme,
} from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { TOKEN_NAMES, token } from '@/web/theme/tokens';

/**
 * Placeholder index route for the migration skeleton: a theme showcase used
 * to eyeball fonts, radii and palette against the Phase 0 baselines. Phase 4
 * replaces it with the real home page.
 */
export default function Skeleton() {
  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} tt="uppercase" style={{ letterSpacing: '0.14em' }} c="iris">
            ❖ Migration skeleton
          </Text>
          <ColorSchemeToggle />
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

function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme !== 'light';
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}
