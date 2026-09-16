import { Text } from '@mantine/core';
import type { EmbeddedBundleResult } from '@/domain/review/bundle-html';
import { SUMMARY_SECTION_ID } from '@/domain/review/narrative';
import { ChapterReader } from '@/web/components/narrative/chapter-reader';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { PageShell } from '@/web/components/page-shell';
import { DisplayMenu } from '@/web/components/topbar/display-menu';
import { StaticBrand, TopbarFrame } from '@/web/components/topbar/topbar';
import { ReportProblem } from './report-problem';

/** The app's header frame with nothing that needs the app: no nav, no account, no home link. */
function ReportTopbar() {
  return (
    <TopbarFrame
      width="reader"
      start={
        <>
          <StaticBrand />
          <Text component="span" fz="sm" c="dimmed">
            Local review
          </Text>
        </>
      }
      end={<DisplayMenu reader />}
    />
  );
}

/**
 * The local report: the hosted reader, fed from the bundle embedded in the
 * page instead of from the database and GitHub. Everything the reader shows
 * comes from the same components; only the file source and the header data
 * differ.
 */
export function ViewerPage({ result }: { result: EmbeddedBundleResult }) {
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
        width="reader"
        style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}
      >
        <title>{`${bundle.review.prTitle || bundle.meta.title} · enhanced-review`}</title>
        <EmbeddedFileSource bundle={bundle}>
          {/*
           * No findings: a local review reports what validating it found in
           * the terminal and in the run folder, where the person who ran it
           * is already looking, and the report is a file they may forward to
           * someone who was not there.
           */}
          <ChapterReader
            review={bundle.review}
            meta={bundle.meta}
            initialActiveId={SUMMARY_SECTION_ID}
            findings={[]}
          />
        </EmbeddedFileSource>
      </PageShell>
    </>
  );
}
