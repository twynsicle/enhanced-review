import { Sparkles } from 'lucide-react';
import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { BrandMark } from '@/components/topbar/brand-mark';
import { auth } from '@/lib/auth/auth';
import { SignInButton } from './sign-in-button';

export const metadata = {
  title: 'Sign in — enhanced-review',
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/');

  return (
    <main className="relative flex min-h-full flex-col">
      {/* Backdrop: subtle radial gradient that respects the OKLCH grayscale palette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,_oklch(1_0_0/0.06),_transparent_70%)]"
      />
      <header className="flex items-center justify-end p-4 sm:p-6">
        <ThemeToggle />
      </header>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-6 text-center">
            <BrandMark size={48} />
            <div className="flex flex-col gap-2">
              <h1 className="font-serif text-3xl font-semibold tracking-[-0.015em] sm:text-4xl">
                Enhanced&nbsp;Review
              </h1>
              <p className="text-sm text-muted-foreground">
                AI code-review that reads like a senior engineer&rsquo;s walkthrough.
              </p>
            </div>
          </div>
          <div className="mt-10 rounded-2xl bg-card p-6 ring-1 ring-foreground/10 sm:p-7">
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Invite-only beta. Sign in with the GitHub account that&rsquo;s been added to the
                  allowlist — we&rsquo;ll need{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">repo</code> read scope to
                  fetch diffs.
                </p>
              </div>
              <SignInButton />
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            By signing in you agree to leave us alone if the AI says something silly.
          </p>
        </div>
      </div>
    </main>
  );
}
