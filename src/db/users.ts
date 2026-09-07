import { prisma } from './client.ts';
import type { User } from './generated/client.ts';

export type UserRow = User;

/** What GitHub tells us about the signed-in account; see domain/auth. */
export interface GithubIdentity {
  githubId: bigint;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

export function findUserById(id: string): Promise<UserRow | null> {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Create-or-refresh keyed on the GitHub numeric id (phase-2-plan P2-D1).
 * Login, name and avatar are overwritten on every sign-in so a GitHub rename
 * or avatar change shows up next time the user signs in.
 */
export function upsertUserFromGithub(identity: GithubIdentity): Promise<UserRow> {
  const { githubId, githubLogin, name, avatarUrl } = identity;
  return prisma.user.upsert({
    where: { githubId },
    create: { githubId, githubLogin, name, avatarUrl },
    update: { githubLogin, name, avatarUrl },
  });
}
