import type { ReviewBundle } from '@/review/bundle';
import type { EmbeddedBundleResult } from '@/review/bundle-html';
import { SUMMARY_SECTION_ID } from '@/review/narrative';
import { ChapterReader } from '@/report/reader/chapter-reader';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { changeLabel, documentTitle } from '@/report/chrome/change-label';
import { PageShell } from '@/report/chrome/page-shell';
import { DisplayMenu } from '@/report/chrome/display-menu';
import { Brand, TopbarChange, TopbarFrame } from '@/report/chrome/topbar';
import { ReportProblem } from './report-problem';

/** The header: the brand, the change when there is one to name, and the display settings. */
function ReportTopbar({ bundle }: { bundle?: ReviewBundle }) {
  return (
    <TopbarFrame
      start={
        <>
          <Brand />
          {bundle && <TopbarChange {...changeLabel(bundle.review, bundle.meta)} />}
        </>
      }
      end={<DisplayMenu />}
    />
  );
}

/**
 * The report: the reader, fed from the bundle embedded in the page, or the
 * reason there is no bundle to read.
 */
export function ReportPage({ result }: { result: EmbeddedBundleResult }) {
  if (!result.ok) {
    return (
      <>
        <ReportTopbar />
        <ReportProblem problem={result} />
      </>
    );
  }
  const { bundle } = result;
  return (
    <>
      <ReportTopbar bundle={bundle} />
      {/*
       * No bottom padding: the reader ends its own column with room instead.
       * The sidebar is sticky, so it can never sit lower than the end of the
       * reader's grid, and padding after the grid held it that far above the
       * window's bottom once the page was scrolled to its end.
       */}
      <PageShell py={32} pb={0} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <title>{documentTitle(bundle.review, bundle.meta)}</title>
        <EmbeddedFileSource bundle={bundle}>
          {/*
           * The report carries no findings. Whoever ran `er` is told what
           * validating the review found, in the terminal and in
           * findings.json, so the report is kept to the review itself.
           */}
          <ChapterReader
            review={bundle.review}
            meta={bundle.meta}
            initialActiveId={SUMMARY_SECTION_ID}
          />
        </EmbeddedFileSource>
      </PageShell>
    </>
  );
}
