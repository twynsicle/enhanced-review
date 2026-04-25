import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelinkButton } from './relink-button';

export const metadata = {
  title: 'Re-link GitHub · enhanced-review',
};

/**
 * Landing page when GitHub rejects our `provider_token`. Asks the user to
 * re-run the OAuth flow. Phase 2 doc explains why we don't try to refresh
 * the token automatically.
 */
export default function RelinkPage() {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Re-link your GitHub account</CardTitle>
          <CardDescription>
            Your GitHub access token is no longer valid. This usually means it was revoked, your org
            changed its OAuth policy, or you signed in before we requested the new scope. Sign in
            again to refresh it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RelinkButton />
        </CardContent>
      </Card>
    </main>
  );
}
