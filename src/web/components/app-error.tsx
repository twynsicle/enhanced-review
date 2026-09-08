import { Text, Title } from '@mantine/core';
import { isRouteErrorResponse } from 'react-router';

/**
 * The generic error page: the root ErrorBoundary renders it for everything,
 * and route boundaries with their own 404 copy fall back to it for the rest.
 * Browser-safe so route modules can import it without pulling in root.tsx.
 */
export function AppError({ error }: { error: unknown }) {
  let title = 'Something went wrong';
  let detail = 'An unexpected error occurred.';
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Not found' : `Error ${String(error.status)}`;
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
