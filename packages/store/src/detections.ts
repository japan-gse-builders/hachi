import { createHash } from 'node:crypto';
import { applyDetections, planNotifications, type CaseChange, type ContactChannel, type Detection, type Locale } from '@hachi/core';
import type { OutboxEntry, Resident } from './model.js';
import type { Store } from './types.js';

export interface RecordDetectionsOptions {
  now: Date;
  newId: () => string;
  /** Origin of the staff/family web app, used for links in notifications. */
  appBaseUrl: string;
  locale: Locale;
  /** Channels handled elsewhere (an emergency bridge already phones family and staff). */
  skipChannels?: ContactChannel[];
}

export interface RecordDetectionsResult {
  changes: CaseChange[];
  outbox: OutboxEntry[];
}

export function outboxId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex');
}

/**
 * Merges detections into the resident's open cases and queues the resulting notifications.
 * Existing cases are updated in a transaction so concurrent staff edits are not lost; the outbox
 * is keyed by idempotency key, so a retried call never notifies twice.
 */
export async function recordDetections(
  store: Store,
  resident: Resident,
  detections: Detection[],
  opts: RecordDetectionsOptions,
): Promise<RecordDetectionsResult> {
  const changes: CaseChange[] = [];
  for (const d of detections) {
    const open = (await store.listCasesByResident(resident.id)).find((c) => c.rule === d.rule && c.status !== 'closed');
    if (!open) {
      const { cases, changes: [change] } = applyDetections([], [d], opts.newId);
      await store.putCase(cases[0]!);
      changes.push(change!);
      continue;
    }
    let change: CaseChange | undefined;
    await store.mutateCase(open.id, (current) => {
      const r = applyDetections([current], [d], opts.newId);
      change = r.changes[0];
      return { case: { ...current, ...r.cases[0]! }, events: [] };
    });
    changes.push(change!);
  }

  const skip = new Set(opts.skipChannels ?? []);
  const createdAt = opts.now.toISOString();
  const entries: OutboxEntry[] = changes.flatMap((change) =>
    planNotifications(change, {
      residentName: resident.name,
      preferredName: resident.preferredName,
      staff: resident.staff,
      ...(resident.family ? { family: resident.family } : {}),
      staffPhone: resident.staff.phone,
      caseUrl: `${opts.appBaseUrl}/staff/cases/${change.caseId}`,
      dashboardUrl: `${opts.appBaseUrl}/family`,
      locale: opts.locale,
    })
      .filter((m) => !skip.has(m.channel))
      .map((m) => ({ ...m, id: outboxId(m.idempotencyKey), residentId: resident.id, status: 'pending' as const, attempts: 0, createdAt })),
  );
  const outbox = await store.enqueueOutbox(entries);
  return { changes, outbox };
}
