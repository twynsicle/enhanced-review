import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { JobNotifications } from '@/components/notifications/job-notifications';
import { ThemeInitScript } from '@/components/theme/theme-init-script';
import { Toaster } from '@/components/ui/toaster';
import { getCurrentUser } from '@/lib/pb';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'enhanced-review',
  description: 'AI code-review for closed beta.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Look up the signed-in user once for the cross-page job notifier.
  // The proxy.ts gate ensures only authenticated users reach the
  // protected pages; on /login and /denied `user` is null and the
  // notifier doesn't mount. Toaster is always available so unauthed
  // pages can still surface error toasts.
  const user = await getCurrentUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster />
        {user ? <JobNotifications userId={user.id} /> : null}
      </body>
    </html>
  );
}
