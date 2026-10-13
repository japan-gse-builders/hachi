import type { EnqueueRequest } from './tasks.js';

/** The telephony service's route that dials one call. */
export const PLACE_CALL_PATH = '/tasks/place-call';

/**
 * Asks the telephony service to ring a resident now, because a member of staff asked (issue #13).
 * The task name follows the call id, so a request that is delivered twice still dials once.
 */
export function staffCallTask(residentId: string, localDate: string, seq: number, requestedBy: string): EnqueueRequest {
  const safe = residentId.replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    name: `call-${safe}-${localDate}-now-${seq}`,
    path: PLACE_CALL_PATH,
    body: { residentId, localDate, attempt: 0, staff: { seq, requestedBy } },
  };
}
