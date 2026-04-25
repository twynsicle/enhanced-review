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
        <CardContent>
          <p className="text-sm text-muted-foreground">
            If you think this is a mistake, reach out to the operator who invited you.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
