import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Access denied — enhanced-review',
};

export default function DeniedPage() {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            enhanced-review is in invite-only beta. Your GitHub account isn&apos;t on the allowlist
            yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            If you think this is a mistake, reach out to the operator who invited you so they can
            add you to the allowlist.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Try a different account →</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
