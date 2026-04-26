import Link from 'next/link';

/**
 * Custom not-found for `/reviews/:id`. Reached when the id is unknown
 * (the redirect for "job exists but isn't done" lives in `page.tsx`).
 */
export default function ReviewNotFound() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center gap-6 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Review not found</h1>
      <p className="text-sm text-muted-foreground">
        This review id doesn&rsquo;t match any job we know about. It may have been deleted, or the
        link may be wrong.
      </p>
      <Link href="/history" className="text-sm font-medium text-primary hover:underline">
        Back to review history →
      </Link>
    </main>
  );
}
