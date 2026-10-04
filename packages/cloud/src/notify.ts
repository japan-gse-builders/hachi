import type { EnqueueRequest, TaskQueue } from './tasks.js';

export const SEND_NOTIFICATION_PATH = '/tasks/send';

/** Twilio status callbacks for notifier SMS and voice alerts, served by the public telephony service. */
export const DELIVERY_STATUS_PATH = '/twilio/delivery-status';

export function deliveryStatusUrl(baseUrl: string, outboxId: string): string {
  return `${baseUrl}${DELIVERY_STATUS_PATH}?outboxId=${encodeURIComponent(outboxId)}`;
}

/** One task per outbox entry and attempt; a duplicate request for the same attempt is a no-op. */
export function notificationTask(outboxId: string, attempt = 0): EnqueueRequest {
  return { name: `outbox-${outboxId}-a${attempt}`, path: SEND_NOTIFICATION_PATH, body: { outboxId } };
}

/**
 * Asks the notification worker to send these entries now. Failures are returned rather than
 * thrown: the worker's periodic sweep sends anything that was not queued here.
 */
export async function requestDelivery(queue: TaskQueue, outboxIds: string[]): Promise<{ queued: number; errors: string[] }> {
  const results = await Promise.allSettled(outboxIds.map((id) => queue.enqueue(notificationTask(id))));
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  return { queued: results.length - errors.length, errors };
}
