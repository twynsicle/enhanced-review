'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

/**
 * Opt-in browser-notification toggle. Hides itself when the browser
 * doesn't support `Notification`, when the user has already granted
 * permission, or when they've denied it (denial is sticky and we don't
 * want to nag).
 */
export function EnableNotificationsButton() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'unsupported',
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    setPermission(Notification.permission);
  }, []);

  const onClick = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        toast({
          title: 'Notifications enabled',
          description: "You'll get a system notification when a review finishes.",
          variant: 'success',
        });
      } else if (result === 'denied') {
        toast({
          title: 'Notifications blocked',
          description: 'Re-enable from your browser settings if you change your mind.',
          variant: 'destructive',
        });
      }
    } catch {
      /* swallowed: some browsers throw when called outside a user gesture */
    }
  }, []);

  if (permission === 'unsupported' || permission === 'granted' || permission === 'denied') {
    return null;
  }
  return (
    <Button variant="outline" size="sm" className="w-full" onClick={onClick}>
      Enable browser notifications
    </Button>
  );
}
