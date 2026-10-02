import { describe, expect, it } from 'vitest';
import { MemoryStore, outboxId, recordDetections } from '@hachi/store';
import { detection, makeResident, NOW, storedCase } from './helpers.js';

function setup() {
  const store = new MemoryStore();
  let n = 0;
  const opts = { now: NOW, newId: () => `case-${++n}`, appBaseUrl: 'https://app.example', locale: 'en' as const };
  return { store, opts };
}

const r1 = detection({ rule: 'R1', urgency: 'emergency', summary: 'Reported chest pain', evidence: [{ callId: 'c1', quote: 'My chest hurts' }] });

describe('recordDetections', () => {
  it('opens an emergency case and queues immediate notifications for staff and family', async () => {
    const { store, opts } = setup();
    const resident = makeResident('res-1');
    const { changes, outbox } = await recordDetections(store, resident, [r1], opts);
    expect(changes).toMatchObject([{ type: 'created', caseId: 'case-1', to: 'emergency' }]);
    expect((await store.getCase('case-1'))?.autoUrgency).toBe('emergency');
    expect(outbox.map((e) => `${e.recipient}:${e.channel}`).sort()).toEqual([
      'family:email',
      'family:sms',
      'family:voice',
      'staff:email',
      'staff:voice',
    ]);
    expect(outbox.every((e) => e.priority === 'immediate' && e.status === 'pending' && e.residentId === 'res-1')).toBe(true);
    expect(outbox[0]!.id).toBe(outboxId(outbox[0]!.idempotencyKey));
    expect(outbox.find((e) => e.recipient === 'staff')!.body).toContain('https://app.example/staff/cases/case-1');
    expect(outbox.find((e) => e.recipient === 'family')!.body).not.toContain('My chest hurts');
  });

  it('skips channels handled elsewhere', async () => {
    const { store, opts } = setup();
    const resident = makeResident('res-1', { family: { name: 'Alice', sms: '+819000000002', voice: '+819000000002' } });
    const { outbox } = await recordDetections(store, resident, [r1], { ...opts, skipChannels: ['voice'] });
    expect(outbox.some((e) => e.channel === 'voice')).toBe(false);
  });

  it('merges into an open case without losing staff fields, and never notifies twice', async () => {
    const { store, opts } = setup();
    const resident = makeResident('res-1');
    await store.putCase(storedCase({ id: 'existing', rule: 'R1', autoUrgency: 'emergency', staffScoreOffset: 5 }));
    const first = await recordDetections(store, resident, [r1], opts);
    expect(first.changes).toMatchObject([{ type: 'updated', caseId: 'existing' }]);
    expect(first.outbox).toEqual([]);
    const c = (await store.getCase('existing'))!;
    expect(c.detections).toHaveLength(2);
    expect(c.staffScoreOffset).toBe(5);
  });

  it('escalates an open case and is idempotent when retried', async () => {
    const { store, opts } = setup();
    const resident = makeResident('res-1');
    await store.putCase(storedCase({ id: 'r2', rule: 'R2', autoUrgency: 'watch' }));
    const urgent = detection({ urgency: 'urgent' });
    const a = await recordDetections(store, resident, [urgent], opts);
    expect(a.changes).toMatchObject([{ type: 'escalated', to: 'urgent' }]);
    expect(a.outbox.every((e) => e.recipient === 'staff')).toBe(true);
    expect(a.outbox.length).toBeGreaterThan(0);
    await store.putCase(storedCase({ id: 'r2', rule: 'R2', autoUrgency: 'watch' }));
    const retried = await recordDetections(store, resident, [urgent], opts);
    expect(retried.outbox).toEqual([]);
  });

  it('ignores closed cases', async () => {
    const { store, opts } = setup();
    await store.putCase(storedCase({ id: 'old', rule: 'R1', autoUrgency: 'emergency', status: 'closed' }));
    const { changes } = await recordDetections(store, makeResident('res-1'), [r1], opts);
    expect(changes[0]).toMatchObject({ type: 'created', caseId: 'case-1' });
  });
});
