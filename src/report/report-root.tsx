import { Component, type ReactNode } from 'react';
import type { EmbeddedBundleResult } from '@/review/bundle-html';
import { ReportCrashed } from './report-problem';
import { ReportPage } from './report-page';

/**
 * Catches a throw from anywhere in the page and shows `ReportCrashed` instead
 * of a blank one. Nothing from the error reaches the page: React has already
 * logged it to the console, which is where whoever generated the file looks.
 */
class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  render() {
    return this.state.crashed ? <ReportCrashed /> : this.props.children;
  }
}

/** The whole report, kept apart from `main.tsx` so a test can mount it. */
export function ReportRoot({ result }: { result: EmbeddedBundleResult }) {
  return (
    <CrashBoundary>
      <ReportPage result={result} />
    </CrashBoundary>
  );
}
