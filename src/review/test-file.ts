const TEST_PATH_SEGMENT = /^(__tests__|tests?|specs?)$/i;

/** Whether a path names a test file, by any of the common conventions for one. */
export function isTestFile(filename: string): boolean {
  const segments = filename.split('/');
  const base = segments[segments.length - 1] ?? filename;
  return (
    /\.(test|spec)\.[^./]+$/i.test(base) ||
    /_test\.[^./]+$/i.test(base) ||
    /^test_/i.test(base) ||
    segments.some((segment) => TEST_PATH_SEGMENT.test(segment))
  );
}
