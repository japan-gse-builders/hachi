import { notificationKey } from '@hachi/core';
import { describe, expect, it, vi } from 'vitest';
import { recordDelivery, recordNotificationOnCase } from '../src/delivery.js';
import { outboxId } from '../src/detections.js';
import { MemoryStore } from '../src/memory.js';
import type { OutboxEntry, StoredCase } from '../src/model.js';

const SENT_AT = '2026-10-02T03:00:00.000Z';
const SID = 'SM0123456789abcdef0123456789abcdef';
const key = notificationKey('case-1', 'emergency', 'family', 'sms', '+819000000002');

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: outboxId(key),
    idempotencyKey: key,
    caseId: 'case-1',
    residentId: 'res-1',
    orgId: 'org-1',
    urgency: 'emergency',
    recipient: 'family',
    channel: 'sms',
    address: '+819000000002',
    subject: 's',
    body: 'b',
    priority: 'immediate',
    status: 'sent',
    attempts: 1,
    createdAt: SENT_AT,
    sentAt: SENT_AT,
    providerId: SID,
    ...overrides,
  };
}

function storedCase(): StoredCase {
  return {
    id: 'case-1',
    residentId: 'res-1',
    orgId: 'org-1',
    rule: 'R1',
    autoUrgency: 'emergency',
    status: 'open',
    detections: [],
    firstDetectedAt: SENT_AT,
    updatedAt: SENT_AT,
    notifications: [],
  };
}

async function setup(e: OutboxEntry = entry()) {
  const store = new MemoryStore();
  await store.putCase(storedCase());
  await store.enqueueOutbox([e]);
  await recordNotificationOnCase(store, e);
  return { store, id: e.id };
}

const at = (s: number) => new Date(Date.parse(SENT_AT) + s * 1000).toISOString();

describe('recordDelivery', () => {
  it('stores the report on the outbox entry and the case record', async () => {
    const { store, id } = await setup();
    const report = { status: 'undelivered' as const, errorCode: '30007', at: at(5) };
    expect(await recordDelivery(store, id, SID, report)).toBe('updated');
    expect((await store.getOutbox(id))!.delivery).toEqual(report);
    expect((await store.getCase('case-1'))!.notifications).toEqual([
      { recipient: 'family', channel: 'sms', address: '+819000000002', sentAt: SENT_AT, delivery: report },
    ]);
  });

  it('is idempotent and never lets a late "sent" replace a final status', async () => {
    const { store, id } = await setup();
    await recordDelivery(store, id, SID, { status: 'sent', at: at(1) });
    expect(await recordDelivery(store, id, SID, { status: 'delivered', at: at(3) })).toBe('updated');
    const mutate = vi.spyOn(store, 'mutateCase');
    expect(await recordDelivery(store, id, SID, { status: 'delivered', at: at(4) })).toBe('stale');
    expect(await recordDelivery(store, id, SID, { status: 'sent', at: at(5) })).toBe('stale');
    expect(mutate).not.toHaveBeenCalled();
    expect((await store.getOutbox(id))!.delivery).toEqual({ status: 'delivered', at: at(3) });
    expect((await store.getCase('case-1'))!.notifications[0]!.delivery).toEqual({ status: 'delivered', at: at(3) });
  });

  it('ignores reports for a different send of the same entry', async () => {
    const { store, id } = await setup();
    expect(await recordDelivery(store, id, 'SMffffffffffffffffffffffffffffffff', { status: 'delivered', at: at(1) })).toBe('mismatch');
    expect((await store.getOutbox(id))!.delivery).toBeUndefined();
  });

  it('accepts a report that arrives before the entry is marked sent, and records it on the case later', async () => {
    const pending = entry({ status: 'pending', sentAt: undefined, providerId: undefined });
    const { store, id } = await setup(pending);
    const report = { status: 'sent' as const, at: at(1) };
    expect(await recordDelivery(store, id, SID, report)).toBe('updated');
    expect((await store.getCase('case-1'))!.notifications).toEqual([]);
    await store.updateOutbox(id, (e) => ({ ...e, status: 'sent', sentAt: SENT_AT, providerId: SID }));
    await recordNotificationOnCase(store, (await store.getOutbox(id))!);
    expect((await store.getCase('case-1'))!.notifications[0]!.delivery).toEqual(report);
  });

  it('merges into a case record written without the report', async () => {
    const { store, id } = await setup();
    const withReport = { ...(await store.getOutbox(id))!, delivery: { status: 'delivered' as const, at: at(2) } };
    await recordNotificationOnCase(store, withReport);
    await recordNotificationOnCase(store, withReport);
    const notifications = (await store.getCase('case-1'))!.notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.delivery).toEqual(withReport.delivery);
  });

  it('handles missing entries and cases', async () => {
    const store = new MemoryStore();
    expect(await recordDelivery(store, 'f'.repeat(64), SID, { status: 'sent', at: at(1) })).toBe('not_found');
    await store.enqueueOutbox([entry({ caseId: 'gone' })]);
    expect(await recordDelivery(store, entry().id, SID, { status: 'delivered', at: at(1) })).toBe('updated');
  });

  it('passes on unexpected store errors', async () => {
    const { store, id } = await setup();
    vi.spyOn(store, 'updateOutbox').mockRejectedValueOnce(new Error('unavailable'));
    await expect(recordDelivery(store, id, SID, { status: 'sent', at: at(1) })).rejects.toThrow(/unavailable/);
    vi.spyOn(store, 'mutateCase').mockRejectedValueOnce(new Error('contention'));
    await expect(recordDelivery(store, id, SID, { status: 'sent', at: at(1) })).rejects.toThrow(/contention/);
  });
});

describe('recordNotificationOnCase', () => {
  it('does nothing for entries that were never sent', async () => {
    const store = new MemoryStore();
    await store.putCase(storedCase());
    await recordNotificationOnCase(store, entry({ sentAt: undefined }));
    expect((await store.getCase('case-1'))!.notifications).toEqual([]);
  });
});
