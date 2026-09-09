import { Avatar, Box, Menu, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBell, IconClock, IconLogout } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { useHydrated } from '@/web/lib/use-hydrated';
import { token } from '@/web/theme/tokens';

export interface TopbarUser {
  login: string;
  fullName: string | null;
  avatarUrl: string | null;
}

type NotifPermission = NotificationPermission | 'unsupported';

export function UserMenu({ user }: { user: TopbarUser }) {
  const signOut = useFetcher();
  const signingOut = signOut.state !== 'idle';
  // `Notification.permission` is browser-only, so it is read only once
  // hydrated (SSR renders the menu without the item); a fresh answer from
  // `requestPermission` takes precedence afterwards.
  const hydrated = useHydrated();
  const [requested, setRequested] = useState<NotificationPermission | null>(null);
  const notifPermission: NotifPermission =
    requested ??
    (hydrated && typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  const enableNotifs = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setRequested(result);
      if (result === 'granted') {
        notifications.show({
          title: 'Notifications enabled',
          message: "You'll get a system notification when a review finishes.",
          color: 'mint',
        });
      } else if (result === 'denied') {
        notifications.show({
          title: 'Notifications blocked',
          message: 'Re-enable from your browser settings if you change your mind.',
          color: 'risk',
        });
      }
    } catch {
      /* some browsers throw outside a user gesture */
    }
  };

  const initials = (user.fullName ?? user.login).slice(0, 2).toUpperCase();

  return (
    <Menu position="bottom-end" width={224} shadow="md" offset={6}>
      <Menu.Target>
        <UnstyledButton
          aria-label="Open user menu"
          ml={4}
          style={{
            display: 'inline-flex',
            width: 32,
            height: 32,
            borderRadius: '50%',
            overflow: 'hidden',
            boxShadow: `0 0 0 1px color-mix(in oklab, ${token('foreground')} 15%, transparent)`,
          }}
        >
          <Avatar src={user.avatarUrl} alt="" size={32} radius="xl" color="gray">
            <Text fz="xs" fw={600} c="dimmed">
              {initials}
            </Text>
          </Avatar>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Box px={8} py={8}>
          <Text size="sm" fw={500} truncate>
            {user.fullName ?? user.login}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            @{user.login}
          </Text>
        </Box>
        <Menu.Divider />
        <Menu.Item component={Link} to="/history" leftSection={<IconClock size={16} />}>
          Review history
        </Menu.Item>
        {notifPermission === 'default' && (
          <Menu.Item leftSection={<IconBell size={16} />} onClick={() => void enableNotifs()}>
            Enable notifications
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item
          color="risk"
          leftSection={<IconLogout size={16} />}
          disabled={signingOut}
          closeMenuOnClick={false}
          onClick={() => signOut.submit(null, { method: 'post', action: '/auth/logout' })}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
