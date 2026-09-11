import type { EmbeddedBundleResult } from '@/domain/review/bundle-html';
import { SUMMARY_SECTION_ID } from '@/domain/review/narrative';
import { ChapterReader } from '@/web/components/narrative/chapter-reader';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { PageShell } from '@/web/components/page-shell';
import { ReportProblem } from './report-problem';

/**
 * The local report: the hosted reader, fed from the bundle embedded in the
 * page instead of from the database and GitHub. Everything the reader shows
 * comes from the same components; only the file source and the header data
 * differ.
 */
export function ViewerPage({ result }: { result: EmbeddedBundleResult }) {
  if (!result.ok) return <ReportProblem problem={result} />;
  const { bundle } = result;
  return (
    <PageShell
      py={32}
      style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}
    >
      <title>{`${bundle.review.prTitle || bundle.meta.title} · enhanced-review`}</title>
      <EmbeddedFileSource bundle={bundle}>
        <ChapterReader
          review={bundle.review}
          meta={bundle.meta}
          initialActiveId={SUMMARY_SECTION_ID}
        />
      </EmbeddedFileSource>
    </PageShell>
  );
}
