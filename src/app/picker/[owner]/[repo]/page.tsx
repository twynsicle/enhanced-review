import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { RepoDetail } from './repo-detail';

export const metadata = {
  title: 'Repo · enhanced-review',
};

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6 pb-32">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Repository</p>
          <h1 className="text-2xl font-semibold">
            {owner}/{repo}
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/picker">← All repos</Link>
        </Button>
      </header>
      <RepoDetail owner={owner} repo={repo} />
    </main>
  );
}
