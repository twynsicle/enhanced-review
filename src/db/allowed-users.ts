import { prisma } from './client.ts';

/** Exact-match lookup; GitHub logins are case-insensitive but stored as given. */
export async function isLoginAllowed(githubLogin: string): Promise<boolean> {
  const row = await prisma.allowedUser.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  return row !== null;
}

export interface SeedResult {
  added: number;
  existing: number;
}

/** Idempotent bulk insert used by the seed-allowlist job. */
export async function addAllowedLogins(githubLogins: string[]): Promise<SeedResult> {
  const unique = [...new Set(githubLogins)];
  if (unique.length === 0) return { added: 0, existing: 0 };
  const result = await prisma.allowedUser.createMany({
    data: unique.map((githubLogin) => ({ githubLogin })),
    skipDuplicates: true,
  });
  return { added: result.count, existing: unique.length - result.count };
}

export async function removeAllowedLogin(githubLogin: string): Promise<boolean> {
  const result = await prisma.allowedUser.deleteMany({ where: { githubLogin } });
  return result.count > 0;
}
