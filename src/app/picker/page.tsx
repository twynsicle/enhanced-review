import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { RepoList } from './repo-list';

export const metadata = {
  title: 'Pick a repo · enhanced-review',
};

/**
 * Repo list page. Auth + allowlist are enforced upstream by `proxy.ts`,
 * so by the time we render the user is signed in and authorised.
 *
 * Data fetching itself happens client-side in {@link RepoList} so a
 * GitHub auth failure can redirect the browser to `/relink` cleanly.
 */
export default function PickerPage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pick a repo</h1>
          <p className="text-sm text-muted-foreground">
            Choose a repository, then a PR or branch to review.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">← Home</Link>
        </Button>
      </header>
      <RepoList />
    </main>
  );
}
