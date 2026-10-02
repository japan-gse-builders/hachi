import type { EnqueueRequest } from './tasks.js';

export const ANALYZE_CALL_PATH = '/tasks/analyze';

/**
 * `key` separates passes over the same call (for example one per media stream), so a later
 * stream is analysed again instead of being deduplicated away.
 */
export function analysisTask(residentId: string, callId: string, key: string, scheduleAt?: Date): EnqueueRequest {
  return {
    name: `analyze-${residentId}-${callId}-${key}`,
    path: ANALYZE_CALL_PATH,
    body: { residentId, callId },
    ...(scheduleAt ? { scheduleAt } : {}),
  };
}
