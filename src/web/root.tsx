import './theme/theme.css';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, Text, Title } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import { COLOR_SCHEME_KEY, colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';
import { sessionMiddleware } from '@/web/auth/session-middleware.server';
import type { Route } from './+types/root';

// Every request: resolve session + user into route context (phase-2-plan P2-D5).
export const middleware: Route.MiddlewareFunction[] = [sessionMiddleware];

export const links: Route.LinksFunction = () => [{ rel: 'icon', href: '/favicon.ico' }];

export const meta: Route.MetaFunction = () => [
  { title: 'enhanced-review' },
  { name: 'description', content: 'AI code-review for closed beta.' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // Dark is the default scheme (A3). ColorSchemeScript swaps in the stored
    // `er-theme` value before first paint, exactly as the old init script did.
    <html lang="en" {...mantineHtmlProps} data-mantine-color-scheme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ColorSchemeScript defaultColorScheme="dark" localStorageKey={COLOR_SCHEME_KEY} />
        <Meta />
        <Links />
      </head>
      <body>
        <MantineProvider
          theme={theme}
          cssVariablesResolver={cssVariablesResolver}
          colorSchemeManager={colorSchemeManager}
          defaultColorScheme="dark"
        >
          <Notifications position="top-right" />
          {children}
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = 'Something went wrong';
  let detail = 'An unexpected error occurred.';
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Not found' : `Error ${error.status}`;
    detail = error.statusText || detail;
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }
  return (
    <main style={{ padding: '4rem 1.5rem', maxWidth: 640, margin: '0 auto' }}>
      <Title order={1}>{title}</Title>
      <Text mt="sm" c="dimmed">
        {detail}
      </Text>
    </main>
  );
}
