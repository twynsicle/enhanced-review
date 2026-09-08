import { data } from 'react-router';
import { z } from 'zod';
import { getJob, listChunksAfter, toJobView } from '@/domain/jobs/jobs.server';
import type { JobPollResponse } from '@/web/lib/jobs-api';
import { parseParams, parseSearchParams } from '@/web/lib/parse.server';
import type { Route } from './+types/api.jobs.$id';

const ParamsSchema = z.object({ id: z.string().min(1) });
const SearchSchema = z.object({ after: z.coerce.number().int().min(-1).default(-1) });

/**
 * GET /api/jobs/:id?after=<seq> — the live view's poll (00-overview D5):
 * the job row plus every chunk with `seq > after`. Gated like a page, so an
 * expired session redirects to /login and the poller sees a non-JSON body.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const { id } = parseParams(ParamsSchema, params);
  const { after } = parseSearchParams(SearchSchema, request);
  const job = await getJob(id);
  if (!job) throw data({ error: 'not_found' }, { status: 404 });
  const chunks = await listChunksAfter(id, after);
  const body: JobPollResponse = { job: toJobView(job), chunks };
  return body;
}
