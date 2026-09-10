import { data } from 'react-router';

/**
 * The one error shape every route action returns. Components read it from
 * `fetcher.data`; the HTTP status carries the same information for anything
 * that talks to the action directly. A rejected GitHub token is *not* an
 * ActionError — actions throw `redirect('/relink')` for that and the fetcher
 * follows it.
 */
export const ACTION_ERROR_REASONS = [
  'job_in_flight',
  'not_cancellable',
  'not_found',
  'invalid_target',
  'head_resolution_failed',
  'schedule_limit',
  'duplicate_schedule',
  'not_schedulable',
  'unknown',
] as const;

export type ActionErrorReason = (typeof ACTION_ERROR_REASONS)[number];

export interface ActionError {
  ok: false;
  reason: ActionErrorReason;
  message: string;
  /** Set with `job_in_flight`: the job the user should look at instead. */
  activeJobId?: string;
}

export const ACTION_ERROR_STATUS: Record<ActionErrorReason, number> = {
  job_in_flight: 409,
  not_cancellable: 409,
  not_found: 404,
  invalid_target: 400,
  head_resolution_failed: 502,
  schedule_limit: 409,
  duplicate_schedule: 409,
  // Covers both "not yours" and "not in a state that allows it", so the
  // response cannot be used to probe who owns a schedule.
  not_schedulable: 409,
  unknown: 500,
};

export function isActionError(value: unknown): value is ActionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

/** Server side: build the `data()` response an action returns for `reason`. */
export function actionError(
  reason: ActionErrorReason,
  message: string,
  extra: { activeJobId?: string } = {},
) {
  const body: ActionError = { ok: false, reason, message, ...extra };
  return data(body, { status: ACTION_ERROR_STATUS[reason] });
}
