// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/domain/auth/sign-in.server';
import { userContext } from '@/web/auth/context.server';
import { loader } from './_shell';

function load(user: SessionUser | null) {
  const context = new RouterContextProvider();
  context.set(userContext, user);
  return loader({ context, request: new Request('http://localhost/'), params: {} } as never);
}

describe('_shell loader', () => {
  it('maps the session user to the topbar shape and hands out the polling config', () => {
    const result = load({
      id: 'u1',
      githubLogin: 'alice',
      name: 'Alice',
      avatarUrl: 'https://example.test/a.png',
    });
    expect(result.user).toEqual({
      login: 'alice',
      fullName: 'Alice',
      avatarUrl: 'https://example.test/a.png',
    });
    expect(result.polling.liveMs).toBeGreaterThan(0);
    expect(result.polling.terminalMs).toBeGreaterThan(result.polling.liveMs);
    expect(new Date(result.serverNow).getTime()).not.toBeNaN();
  });

  it('passes a missing user through as null', () => {
    expect(load(null).user).toBeNull();
  });
});
