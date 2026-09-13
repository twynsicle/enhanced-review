import type { RouteObject } from 'react-router';
import type { EmbeddedBundleResult } from '@/domain/review/bundle-html';
import { ReportCrashed } from './report-problem';
import { ViewerPage } from './viewer-page';

/**
 * The report's route table, apart from `main.tsx` so a test can mount it and
 * hold it to having an `errorElement` — the thing whose absence sent a reader
 * to React Router's built-in developer screen, and which nothing but a test
 * over this table would miss again.
 *
 * One catch-all route, because the report has one page and reaches its
 * sections through the query string rather than the path.
 */
export function reportRoutes(result: EmbeddedBundleResult): RouteObject[] {
  return [{ path: '*', element: <ViewerPage result={result} />, errorElement: <ReportCrashed /> }];
}
