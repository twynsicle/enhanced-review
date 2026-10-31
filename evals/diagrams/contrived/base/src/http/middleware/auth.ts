import { timingSafeEqual } from 'node:crypto';
import type { Middleware } from '../server.ts';

export function requireApiKey(apiKey: string): Middleware {
  const expected = Buffer.from(apiKey);
  return (ctx, next) => {
    const header = ctx.headers['x-api-key'];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    // timingSafeEqual throws on unequal lengths, so the length is checked first;
    // the key's length is not a secret, its contents are.
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.resolve({ status: 401, body: { error: 'missing or wrong api key' } });
    }
    return next();
  };
}
