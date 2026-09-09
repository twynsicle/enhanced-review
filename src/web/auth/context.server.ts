import { createContext } from 'react-router';
import type { SessionUser } from '@/domain/auth/sign-in.server';
import type { LoadedSession } from './session.server';

/**
 * Route context populated by the root session middleware for every request.
 * Loaders/actions read `userContext`; `sessionContext` is for the auth code
 * itself (rolling, sign-out) and is set to null once a session is destroyed.
 */
export const userContext = createContext<SessionUser | null>(null);
export const sessionContext = createContext<LoadedSession | null>(null);
