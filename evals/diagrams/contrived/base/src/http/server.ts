import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { errorFields, log } from '../logger.ts';

export interface Context {
  method: string;
  path: string;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  text: string;
  body: unknown;
}

export interface Reply {
  status: number;
  body?: unknown;
}

export type Handler = (ctx: Context) => Promise<Reply>;

export type Middleware = (ctx: Context, next: () => Promise<Reply>) => Promise<Reply>;

export interface Route {
  method: string;
  path: string;
  /** Run in this order, each deciding whether to call the next; the handler is last. */
  middleware: Middleware[];
  handler: Handler;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i += 1) {
    const part = expected[i]!;
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(actual[i]!);
    else if (part !== actual[i]) return null;
  }
  return params;
}

export function runChain(route: Route, ctx: Context): Promise<Reply> {
  const step = (index: number): Promise<Reply> => {
    const middleware = route.middleware[index];
    return middleware ? middleware(ctx, () => step(index + 1)) : route.handler(ctx);
  };
  return step(0);
}

export function createHttpServer(routes: Route[]): Server {
  return createServer((request, response) => void handle(routes, request, response));
}

async function handle(routes: Route[], request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  let reply: Reply = { status: 404, body: { error: `no route ${method} ${path}` } };
  for (const route of routes) {
    const params = route.method === method ? matchPath(route.path, path) : null;
    if (!params) continue;
    const text = await readText(request);
    const ctx: Context = { method, path, params, headers: request.headers, text, body: undefined };
    reply = await runChain(route, ctx).catch((error: unknown) => {
      log.error('request failed outside its middleware', { method, path, ...errorFields(error) });
      return { status: 500, body: { error: 'internal error' } };
    });
    break;
  }
  response.statusCode = reply.status;
  if (reply.body === undefined) return response.end();
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(reply.body));
}

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
