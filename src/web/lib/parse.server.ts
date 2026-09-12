import { data } from 'react-router';
import type { z } from 'zod';

/**
 * Zod at the route boundary: each helper parses one kind of request input
 * and, on failure, throws a 400 `data()` response that React Router hands to
 * the nearest ErrorBoundary.
 *
 * Route modules import these instead of calling `schema.parse` inline so the
 * error shape is uniform, and so that the `zod-boundaries` guardrail can tell
 * a validated route from an unvalidated one by its imports alone.
 */
export interface BadRequestBody {
  error: 'bad_request';
  issues: { path: string; message: string }[];
}

function badRequest(error: z.ZodError): never {
  const body: BadRequestBody = {
    error: 'bad_request',
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
  throw data(body, { status: 400 });
}

export function parseParams<T extends z.ZodType>(schema: T, params: unknown): z.output<T> {
  const result = schema.safeParse(params);
  return result.success ? result.data : badRequest(result.error);
}

export function parseSearchParams<T extends z.ZodType>(schema: T, request: Request): z.output<T> {
  const entries = Object.fromEntries(new URL(request.url).searchParams);
  const result = schema.safeParse(entries);
  return result.success ? result.data : badRequest(result.error);
}

export async function parseFormData<T extends z.ZodType>(
  schema: T,
  request: Request,
): Promise<z.output<T>> {
  const entries = Object.fromEntries(await request.formData());
  const result = schema.safeParse(entries);
  return result.success ? result.data : badRequest(result.error);
}
