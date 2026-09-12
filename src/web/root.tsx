import './theme/theme.css';
import { AppError } from '@/web/components/app-error';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { COLOR_SCHEME_KEY, colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';
import { LAYOUT_WIDTHS, SIDEBAR_WIDTHS } from '@/web/theme/tokens';
import { sessionMiddleware } from '@/web/auth/session-middleware.server';
import { LAYOUT_WIDTH_KEY } from '@/web/stores/layout-width';
import { SIDEBAR_WIDTH_KEY } from '@/web/stores/sidebar-width';
import type { Route } from './+types/root';

/*
 * The reader's geometry, applied before first paint the way ColorSchemeScript
 * applies the colour scheme: a stored value that differs from the default has
 * to land before anything is drawn, or the page visibly relays itself a frame
 * later. Only geometry earns a script — the rest of the display preferences
 * change what is inside the page, not where its edges are, and rehydrate after
 * mount like everything else.
 *
 * The reader fills the window by default, so the only width worth applying is
 * the narrower `wide` stop. The sidebar is a number and is range-checked
 * instead: `Number(null)` is 0 and an unparseable value is NaN, so both fail
 * the comparison and leave the stylesheet's default alone.
 *
 * The stores themselves still rehydrate after mount, so SSR markup never
 * depends on localStorage.
 */
const GEOMETRY_SCRIPT = `(function(){try{var d=document.documentElement;if(localStorage.getItem(${JSON.stringify(LAYOUT_WIDTH_KEY)})==='wide'){d.style.setProperty('--review-max-width',${JSON.stringify(LAYOUT_WIDTHS.wide)})}var w=Number(localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)}));if(w>=${SIDEBAR_WIDTHS.min}&&w<=${SIDEBAR_WIDTHS.max}){d.style.setProperty('--review-sidebar-width',w+'px')}}catch(e){}})();`;

// Every request: resolve session + user into route context.
export const middleware: Route.MiddlewareFunction[] = [sessionMiddleware];

export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.ico?v=passage', sizes: '16x16 32x32 48x48' },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
];

export const meta: Route.MetaFunction = () => [
  { title: 'enhanced-review' },
  { name: 'description', content: 'AI code-review for closed beta.' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // Dark is the default scheme, so the server can commit to an attribute
    // rather than guess. ColorSchemeScript swaps in the stored `er-theme`
    // value before first paint, which is what keeps a light reader from
    // seeing a dark frame on the way in.
    <html lang="en" {...mantineHtmlProps} data-mantine-color-scheme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ColorSchemeScript defaultColorScheme="dark" localStorageKey={COLOR_SCHEME_KEY} />
        <script dangerouslySetInnerHTML={{ __html: GEOMETRY_SCRIPT }} />
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
