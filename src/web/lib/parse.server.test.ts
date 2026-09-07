import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseFormData, parseParams, parseSearchParams } from './parse.server';

const idSchema = z.object({ id: z.string().min(1) });

async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('parse.server', () => {
  it('parseParams returns typed data on success', () => {
    expect(parseParams(idSchema, { id: 'abc' })).toEqual({ id: 'abc' });
  });

  it('parseParams throws a 400 data response naming the field', async () => {
    // `data()` returns a DataWithResponseInit; React Router turns a thrown one
    // into the ErrorResponse the ErrorBoundary sees.
    const error = await caught(() => parseParams(idSchema, { id: '' }));
    expect(error).toMatchObject({
      type: 'DataWithResponseInit',
      init: { status: 400 },
      data: { error: 'bad_request', issues: [{ path: 'id' }] },
    });
  });

  it('parseSearchParams reads the request URL', () => {
    const schema = z.object({ status: z.enum(['all', 'done']).default('all') });
    const request = new Request('http://localhost/history?status=done');
    expect(parseSearchParams(schema, request)).toEqual({ status: 'done' });
    expect(parseSearchParams(schema, new Request('http://localhost/history'))).toEqual({
      status: 'all',
    });
  });

  it('parseFormData reads multipart/urlencoded bodies', async () => {
    const schema = z.object({ intent: z.literal('cancel') });
    const body = new URLSearchParams({ intent: 'cancel' });
    const request = new Request('http://localhost/jobs/1', { method: 'POST', body });
    await expect(parseFormData(schema, request)).resolves.toEqual({ intent: 'cancel' });

    const bad = new Request('http://localhost/jobs/1', {
      method: 'POST',
      body: new URLSearchParams({ intent: 'explode' }),
    });
    const error = await caught(() => parseFormData(schema, bad));
    expect(error).toMatchObject({ type: 'DataWithResponseInit', init: { status: 400 } });
  });
});
