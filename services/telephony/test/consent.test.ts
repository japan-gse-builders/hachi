import { spendMonth } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { afterStream, emergencyTransfer } from '../src/bridge.js';
import { dispatchDueCalls, placeCall } from '../src/calls.js';
import { makeDeps, NOW, resident } from './fixtures.js';

const input = { residentId: 'res-1', localDate: '2026-10-02', attempt: 0 };
const ids = { residentId: input.residentId, callId: '2026-10-02-0' };

describe('call approval enforcement', () => {
  it('schedules only residents who have explicitly agreed to calls', async () => {
    const { deps, store, queue } = makeDeps();
    await store.createResident(resident('pending', { callConsent: undefined }));
    await store.createResident(resident('approved'));
    expect((await dispatchDueCalls(deps)).enqueued).toBe(1);
    expect(queue.tasks.map((task) => (task.body as typeof input).residentId)).toEqual(['approved']);
  });

  it.each([0, 1])('blocks a direct or previously queued attempt (%i) before calling or reserving money', async (attempt) => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident(input.residentId, { callConsent: undefined }));
    expect(await placeCall(deps, { ...input, attempt }, 0)).toEqual({ outcome: 'skipped', reason: 'consent_required' });
    expect(telephony.calls).toHaveLength(0);
    expect(await store.listCalls(input.residentId)).toEqual([]);
    expect(await store.getSpendLedger(spendMonth(NOW))).toBeNull();
    expect(await store.getGatewayBreaker()).toBeNull();
  });

  it('uses the saved first-use approval on subsequent days, including an earlier notice version', async () => {
    const { deps, store, telephony } = makeDeps();
    const approved = resident(input.residentId);
    await store.createResident({ ...approved, callConsent: { ...approved.callConsent!, noticeVersion: '2026-10-01' } });
    expect((await placeCall(deps, input, 0)).outcome).toBe('placed');
    expect((await placeCall(deps, { ...input, localDate: '2026-10-03' }, 0)).outcome).toBe('placed');
    expect(telephony.calls).toHaveLength(2);
    await store.updateResident(input.residentId, (r) => ({ ...r, active: false }));
    expect(await placeCall(deps, { ...input, localDate: '2026-10-04' }, 0)).toEqual({ outcome: 'skipped', reason: 'inactive' });
  });

  it('does not reconnect an old media stream or schedule a retry without approval', async () => {
    const { deps, store, queue } = makeDeps({ voiceStreamUrl: 'wss://gateway.example/stream' });
    await store.createResident(resident(input.residentId, { callConsent: undefined }));
    await store.createCallIfAbsent({
      ...ids, id: ids.callId, source: 'live', status: 'in_progress', channel: 'pstn',
      startedAt: NOW.toISOString(), createdAt: NOW.toISOString(), analysisPending: false,
      streamToken: 'secret', attempt: 0, localDate: input.localDate,
    });
    expect(await afterStream(deps, ids)).toBe('<Response><Hangup/></Response>');
    expect(queue.tasks).toEqual([]);
  });

  it('preserves the emergency bridge and alert calls for an emergency already raised', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident(input.residentId, { active: false, callConsent: undefined }));
    await store.createCallIfAbsent({
      id: ids.callId, residentId: ids.residentId, source: 'live', status: 'in_progress', channel: 'pstn',
      startedAt: NOW.toISOString(), createdAt: NOW.toISOString(), analysisPending: false,
      emergency: { at: NOW.toISOString(), caseId: 'emergency-1', quote: 'Please help' },
    });
    expect(await afterStream(deps, ids)).toContain('<Conference');
    expect((await emergencyTransfer(deps, ids)).outcome).toBe('placed');
    expect(telephony.calls).toHaveLength(1);
  });
});
