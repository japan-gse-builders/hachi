import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import { MemoryStore } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { EMERGENCY_TRANSFER_PATH, EmergencyService, emergencySummary } from '../src/emergency.js';
import { callDoc, IDS, resident } from './fixtures.js';

class FakeQueue implements TaskQueue {
  readonly tasks = new Map<string, EnqueueRequest>();
  fail = false;
  async enqueue(req: EnqueueRequest): Promise<'created' | 'exists'> {
    if (this.fail) throw new Error('tasks unavailable');
    if (this.tasks.has(req.name)) return 'exists';
    this.tasks.set(req.name, req);
    return 'created';
  }
}

async function setup() {
  const store = new MemoryStore();
  const r = resident({ family: { name: 'Alice', sms: '+819000000002', email: 'alice@example.org', voice: '+819000000002' } });
  await store.createResident(r);
  await store.createCallIfAbsent(callDoc());
  const queue = new FakeQueue();
  let n = 0;
  const service = new EmergencyService({
    store,
    queue,
    appBaseUrl: 'https://app.example',
    now: () => new Date('2026-10-02T01:02:03.000Z'),
    newId: () => `case-${++n}`,
  });
  return { store, queue, service, r };
}

describe('emergencySummary', () => {
  it('describes each category in English', () => {
    expect(emergencySummary({ category: 'chest_pain' })).toMatch(/chest pain/);
    expect(emergencySummary({ category: 'reported_by_agent', symptom: ' dizziness ' })).toBe('Reported a possible emergency during the call (dizziness)');
    expect(emergencySummary({ category: 'reported_by_agent' })).toBe('Reported a possible emergency during the call');
    expect(emergencySummary({ category: 'reported_by_agent', symptom: 'x'.repeat(200) })).toHaveLength(
      'Reported a possible emergency during the call ()'.length + 80,
    );
  });
});

describe('EmergencyService', () => {
  it('opens the R1 case, queues text notifications, marks the call and requests the bridge', async () => {
    const { store, queue, service, r } = await setup();
    await service.raise({ resident: r, callId: IDS.callId, quote: 'My chest hurts', category: 'chest_pain', confidence: 0.9, startMs: 1000, endMs: 2000 });

    const [c] = await store.listCasesByResident(IDS.residentId);
    expect(c).toMatchObject({ id: 'case-1', rule: 'R1', autoUrgency: 'emergency', status: 'open' });
    expect(c!.detections[0]!.evidence).toEqual([{ callId: IDS.callId, quote: 'My chest hurts', startMs: 1000, endMs: 2000 }]);

    const outbox = await store.listOutboxByCase('case-1');
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox.some((e) => e.channel === 'voice')).toBe(false);

    expect((await store.getCall(IDS.residentId, IDS.callId))!.emergency).toEqual({
      at: '2026-10-02T01:02:03.000Z',
      caseId: 'case-1',
      quote: 'My chest hurts',
    });
    expect([...queue.tasks.values()]).toEqual([
      { name: `emergency-${IDS.residentId}-${IDS.callId}`, path: EMERGENCY_TRANSFER_PATH, body: IDS },
    ]);
  });

  it('is safe to retry after a partial failure', async () => {
    const { store, queue, service, r } = await setup();
    queue.fail = true;
    const input = { resident: r, callId: IDS.callId, quote: 'Help me', category: 'calling_for_help' as const, confidence: 0.9 };
    await expect(service.raise(input)).rejects.toThrow(/tasks unavailable/);
    queue.fail = false;
    await service.raise(input);
    await service.raise({ ...input, quote: 'Second time' });

    expect(await store.listCasesByResident(IDS.residentId)).toHaveLength(1);
    const call = (await store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.emergency).toMatchObject({ caseId: 'case-1', quote: 'Help me' });
    expect(queue.tasks.size).toBe(1);
    const outbox = await store.listOutboxByCase('case-1');
    expect(new Set(outbox.map((e) => e.id)).size).toBe(outbox.length);
  });

  it('queues the notifications for immediate delivery, also when retried', async () => {
    const { store, r } = await setup();
    const queue = new FakeQueue();
    const notifications = new FakeQueue();
    const service = new EmergencyService({
      store,
      queue,
      notifications,
      appBaseUrl: 'https://app.example',
      now: () => new Date('2026-10-02T01:02:03.000Z'),
      newId: () => 'case-1',
    });
    const input = { resident: r, callId: IDS.callId, quote: 'Help me', category: 'calling_for_help' as const, confidence: 0.9 };
    queue.fail = true;
    await expect(service.raise(input)).rejects.toThrow();
    expect(notifications.tasks.size).toBe(0);

    queue.fail = false;
    await service.raise(input);
    const outbox = await store.listOutboxByCase('case-1');
    expect([...notifications.tasks.keys()].sort()).toEqual(outbox.map((e) => `outbox-${e.id}-a0`).sort());
    expect([...notifications.tasks.values()][0]).toMatchObject({ path: '/tasks/send' });

    // A failing notification queue never blocks the emergency itself.
    notifications.fail = true;
    await expect(service.raise(input)).resolves.toBeUndefined();
  });

  it('records an emergency reported by the AI without timing', async () => {
    const { store, service, r } = await setup();
    await service.raise({ resident: r, callId: IDS.callId, quote: 'I feel very dizzy', category: 'reported_by_agent', confidence: 0.8, symptom: 'dizziness' });
    const [c] = await store.listCasesByResident(IDS.residentId);
    expect(c!.detections[0]).toMatchObject({ confidence: 0.8, summary: 'Reported a possible emergency during the call (dizziness)' });
    expect(c!.detections[0]!.evidence).toEqual([{ callId: IDS.callId, quote: 'I feel very dizzy' }]);
  });
});
