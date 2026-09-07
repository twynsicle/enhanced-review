import '@mantine/core/styles.css';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, Text, Title } from '@mantine/core';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import type { Route } from './+types/root';

export const links: Route.LinksFunction = () => [{ rel: 'icon', href: '/favicon.ico' }];

export const meta: Route.MetaFunction = () => [
  { title: 'enhanced-review' },
  { name: 'description', content: 'AI code-review for closed beta.' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ColorSchemeScript defaultColorScheme="dark" localStorageKey="er-theme" />
        <Meta />
        <Links />
      </head>
      <body>
        <MantineProvider defaultColorScheme="dark">{children}</MantineProvider>
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
