import { mergeDelivery, type DeliveryReport, type NotificationRecord } from '@hachi/core';
import type { OutboxEntry } from './model.js';
import { NotFoundError, type Store } from './types.js';

/** `stale`: an equal or later status is already stored. `mismatch`: the report is for another send of this entry. */
export type DeliveryUpdateResult = 'updated' | 'stale' | 'mismatch' | 'not_found';

/**
 * NTF-04: adds a sent entry to the case's notification list, or merges its delivery report into the
 * existing record. The notifier and the delivery callback both call this and may race; either order
 * ends with one record carrying the latest report. Safe to call repeatedly.
 */
export async function recordNotificationOnCase(store: Store, e: OutboxEntry): Promise<void> {
  if (!e.sentAt) return;
  // Only an alert belongs to a case. A contact request belongs to a call and a loneliness notice
  // to a rotation, and a contact is not on the case at all.
  if (e.kind || e.recipient === 'contact') return;
  const recipient = e.recipient;
  const sentAt = e.sentAt;
  const same = (n: NotificationRecord) => n.channel === e.channel && n.address === e.address && n.sentAt === sentAt;
  try {
    await store.mutateCase(e.caseId, (c) => {
      const existing = c.notifications.find(same);
      if (!existing) {
        const record: NotificationRecord = {
          recipient,
          channel: e.channel,
          address: e.address,
          sentAt,
          ...(e.delivery ? { delivery: e.delivery } : {}),
        };
        return { case: { ...c, notifications: [...c.notifications, record] }, events: [] };
      }
      if (!e.delivery) return { case: c, events: [] };
      const delivery = mergeDelivery(existing.delivery, e.delivery);
      if (delivery === existing.delivery) return { case: c, events: [] };
      return { case: { ...c, notifications: c.notifications.map((n) => (n === existing ? { ...n, delivery } : n)) }, events: [] };
    });
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
}

/**
 * Stores a provider delivery report on the outbox entry and on the case's notification record.
 * Safe to repeat and to receive out of order (see mergeDelivery).
 */
export async function recordDelivery(store: Store, outboxId: string, providerId: string, report: DeliveryReport): Promise<DeliveryUpdateResult> {
  let result = 'stale' as DeliveryUpdateResult;
  let entry: OutboxEntry;
  try {
    entry = await store.updateOutbox(outboxId, (e) => {
      // The first report can arrive before the provider id is written; the signed callback URL names the entry.
      if (e.providerId && e.providerId !== providerId) {
        result = 'mismatch';
        return null;
      }
      const delivery = mergeDelivery(e.delivery, report);
      if (delivery === e.delivery) return null;
      result = 'updated';
      return { ...e, delivery };
    });
  } catch (err) {
    if (err instanceof NotFoundError) return 'not_found';
    throw err;
  }
  if (result === 'updated') await recordNotificationOnCase(store, entry);
  return result;
}
