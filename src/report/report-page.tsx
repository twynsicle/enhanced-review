import { Text } from '@mantine/core';
import type { EmbeddedBundleResult } from '@/review/bundle-html';
import { SUMMARY_SECTION_ID } from '@/review/narrative';
import { ChapterReader } from '@/report/reader/chapter-reader';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { PageShell } from '@/report/chrome/page-shell';
import { DisplayMenu } from '@/report/chrome/display-menu';
import { Brand, TopbarFrame } from '@/report/chrome/topbar';
import { ReportProblem } from './report-problem';

/** The header: the brand, and the display settings. */
function ReportTopbar() {
  return (
    <TopbarFrame
      start={
        <>
          <Brand />
          <Text component="span" fz="sm" c="dimmed">
            Local review
          </Text>
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
      <ReportTopbar />
      <PageShell
        py={32}
        style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}
      >
        <title>{`${bundle.review.prTitle || bundle.meta.title} · enhanced-review`}</title>
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
