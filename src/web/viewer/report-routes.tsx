import type { RouteObject } from 'react-router';
import type { EmbeddedBundleResult } from '@/domain/review/bundle-html';
import { ReportCrashed } from './report-problem';
import { ViewerPage } from './viewer-page';

/**
 * The report's route table, kept apart from `main.tsx` so a test can mount it
 * and hold it to having an `errorElement`. `main.tsx` creates a root as it is
 * imported, so nothing can mount what it builds; without this split, the
 * absence that sent a reader to React Router's developer screen would go
 * unnoticed a second time.
 *
 * One catch-all route, because the report has one page and reaches its
 * sections through the query string rather than the path.
 */
export function reportRoutes(result: EmbeddedBundleResult): RouteObject[] {
  return [{ path: '*', element: <ViewerPage result={result} />, errorElement: <ReportCrashed /> }];
}
