import { data } from 'react-router';
import { z } from 'zod';
import { listTerminalJobsSince, toJobView } from '@/domain/jobs/jobs.server';
import { userContext } from '@/web/auth/context.server';
import type { TerminalJobsResponse } from '@/web/lib/jobs-api';
import { parseSearchParams } from '@/web/lib/parse.server';
import type { Route } from './+types/api.me.jobs.terminal';

const SearchSchema = z.object({ since: z.iso.datetime({ offset: true }) });

/**
 * GET /api/me/jobs/terminal?since=<iso> — the notifier's poll (00-overview
 * D6): the viewer's jobs that reached `done | error | cancelled` at or after
 * `since`, plus the server clock for the next call. Only the viewer's own
 * jobs (the user comes from the session, never the query).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { since } = parseSearchParams(SearchSchema, request);
  const user = context.get(userContext);
  if (!user) throw data({ error: 'unauthenticated' }, { status: 401 });
  const now = new Date().toISOString();
  const jobs = await listTerminalJobsSince(user.id, new Date(since));
  const body: TerminalJobsResponse = { now, jobs: jobs.map(toJobView) };
  return body;
}
