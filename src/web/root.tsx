import './theme/theme.css';
import { AppError } from '@/web/components/app-error';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { COLOR_SCHEME_KEY, colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';
import { LAYOUT_WIDTHS } from '@/web/theme/tokens';
import { sessionMiddleware } from '@/web/auth/session-middleware.server';
import { LAYOUT_WIDTH_KEY } from '@/web/stores/layout-width';
import type { Route } from './+types/root';

// Applies the stored wide layout before first paint, the way
// ColorSchemeScript does for the colour scheme. The store itself rehydrates
// after mount so SSR markup never depends on localStorage.
const LAYOUT_WIDTH_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(LAYOUT_WIDTH_KEY)})==='wide'){document.documentElement.style.setProperty('--review-max-width',${JSON.stringify(LAYOUT_WIDTHS.wide)})}}catch(e){}})();`;

// Every request: resolve session + user into route context.
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
        <script dangerouslySetInnerHTML={{ __html: LAYOUT_WIDTH_SCRIPT }} />
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
  return <AppError error={error} />;
}
