/**
 * A plain path from the repository root, as git names a blob in a tree:
 * forward slashes, no drive, no `.` or `..` segment and no empty one. A path
 * the model wrote any other way would fail the git that checks it, which
 * would fail the stage rather than drop the one path.
 */
export function isRepositoryPath(filename: string): boolean {
  return (
    !filename.includes(String.fromCharCode(92)) &&
    !/^[A-Za-z]:/.test(filename) &&
    filename.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}
