import { committedMicros, liveCallMicros, spendMonth } from '@hachi/core';
import { MemoryStore, NotFoundError } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import {
  applyCallStatus,
  callIdFor,
  DIAL_LEASE_MS,
  dispatchDueCalls,
  parsePlaceCallInput,
  placeCall,
  PLACEMENT_RETRIES,
  spendLeaseId,
} from '../src/calls.js';
import { BASE_URL, makeDeps, NOW, resident, retryable, unverified } from './fixtures.js';

const INPUT = { residentId: 'res-1', localDate: '2026-10-02', attempt: 0 };

describe('dispatchDueCalls', () => {
  it('enqueues residents whose call time is due, with deterministic task names', async () => {
    const { deps, store, queue } = makeDeps();
    await store.createResident(resident('res-1'));
    await store.createResident(resident('res-2', { callTime: '15:00' }));
    await store.createResident(resident('res-3', { active: false }));
    const r = await dispatchDueCalls(deps);
    expect(r).toEqual({ checked: 2, enqueued: 1, alreadyQueued: 0, errors: [] });
    expect(queue.tasks).toEqual([
      { name: 'call-res-1-2026-10-02-0', path: '/tasks/place-call', body: { residentId: 'res-1', localDate: '2026-10-02', attempt: 0 } },
    ]);
  });

  it('is idempotent across overlapping scheduler runs', async () => {
    const { deps, store, queue, clock } = makeDeps();
    await store.createResident(resident('res-1'));
    await dispatchDueCalls(deps);
    clock.now = new Date(NOW.getTime() + 60_000);
    expect(await dispatchDueCalls(deps)).toMatchObject({ enqueued: 0, alreadyQueued: 1 });
    expect(queue.tasks).toHaveLength(1);
  });

  it('catches up on calls missed within the lookback window', async () => {
    const { deps, store, queue } = makeDeps();
    await store.createResident(resident('res-1', { callTime: '09:55' }));
    await store.createResident(resident('res-2', { callTime: '09:45' }));
    await dispatchDueCalls(deps);
    expect(queue.tasks.map((t) => t.name)).toEqual(['call-res-1-2026-10-02-0']);
  });

  it('uses the resident-local date', async () => {
    const { deps, store, queue } = makeDeps({ now: () => new Date('2026-10-01T15:00:30.000Z') }); // 00:00:30 JST Oct 2
    await store.createResident(resident('res-1', { callTime: '00:00' }));
    await store.createResident(resident('res-2', { callTime: '17:00', timeZone: 'Europe/London' })); // 16:00 BST: not due
    await dispatchDueCalls(deps);
    expect(queue.tasks.map((t) => t.name)).toEqual(['call-res-1-2026-10-02-0']);
  });

  it('reports per-resident errors without stopping the others', async () => {
    const { deps, store, queue } = makeDeps();
    await store.createResident(resident('res-1'));
    await store.createResident(resident('res-2'));
    await store.createResident(resident('res-3', { timeZone: 'Not/AZone' }));
    queue.failFor.add('res-2');
    const r = await dispatchDueCalls(deps);
    expect(r.enqueued).toBe(1);
    expect(r.errors.map((e) => e.residentId).sort()).toEqual(['res-2', 'res-3']);
  });

  it('handles more residents than the concurrency limit', async () => {
    const { deps, store } = makeDeps();
    for (let i = 0; i < 60; i++) await store.createResident(resident(`res-${i}`));
    expect((await dispatchDueCalls(deps)).enqueued).toBe(60);
  });
});

describe('parsePlaceCallInput', () => {
  it('accepts valid input and rejects anything else', () => {
    expect(parsePlaceCallInput(INPUT, 3)).toEqual(INPUT);
    for (const bad of [
      null,
      'x',
      { ...INPUT, residentId: '../etc' },
      { ...INPUT, residentId: 5 },
      { ...INPUT, localDate: '2026/10/02' },
      { ...INPUT, attempt: 3 },
      { ...INPUT, attempt: -1 },
      { ...INPUT, attempt: 1.5 },
    ]) {
      expect(parsePlaceCallInput(bad, 3)).toBeNull();
    }
  });
});

describe('the monthly AI budget', () => {
  const month = spendMonth(NOW);
  const committed = async (store: MemoryStore) => committedMicros((await store.getSpendLedger(month))!);

  it('holds the call cost against the month before the phone rings', async () => {
    const { deps, store } = makeDeps();
    await store.createResident(resident('res-1'));
    await placeCall(deps, INPUT, 0);
    const ledger = (await store.getSpendLedger(month))!;
    expect(ledger.leases.map((l) => l.id)).toEqual([spendLeaseId('res-1', '2026-10-02-0')]);
    // Reserved, not spent: the call is still happening.
    expect(ledger.spentMicros).toBe(0);
    expect(ledger.leases[0]!.micros).toBeGreaterThan(0);
  });

  it('does not place the call when the month cannot afford it', async () => {
    const { deps, store, telephony } = makeDeps({ monthlyCapUsd: 0 });
    await store.createResident(resident('res-1'));
    expect(await placeCall(deps, INPUT, 0)).toEqual({ outcome: 'skipped', reason: 'budget_exhausted' });
    expect(telephony.calls).toHaveLength(0);
    // Recorded against the attempt, so it reads as a reason rather than a call that vanished.
    const call = (await store.getCall('res-1', callIdFor('2026-10-02', 0)))!;
    expect(call).toMatchObject({ status: 'failed', failure: { code: 'budget_exhausted', retryable: false } });
  });

  it('settles the reservation with the seconds Twilio reports', async () => {
    const { deps, store } = makeDeps();
    await store.createResident(resident('res-1'));
    const placed = await placeCall(deps, INPUT, 0);
    const sid = placed.outcome === 'placed' ? placed.providerCallId : '';
    const ids = { residentId: 'res-1', callId: callIdFor('2026-10-02', 0) };
    await applyCallStatus(deps, ids, { CallStatus: 'completed', CallSid: sid, CallDuration: '120' });
    const ledger = (await store.getSpendLedger(month))!;
    expect(ledger.leases).toHaveLength(0);
    expect(ledger.spentMicros).toBe(liveCallMicros(120, deps.config.spend.prices));
  });

  it('charges nothing for a call nobody answered, and ignores a repeated callback', async () => {
    const { deps, store } = makeDeps();
    await store.createResident(resident('res-1'));
    const placed = await placeCall(deps, INPUT, 0);
    const sid = placed.outcome === 'placed' ? placed.providerCallId : '';
    const ids = { residentId: 'res-1', callId: callIdFor('2026-10-02', 0) };
    await applyCallStatus(deps, ids, { CallStatus: 'no-answer', CallSid: sid });
    await applyCallStatus(deps, ids, { CallStatus: 'no-answer', CallSid: sid });
    expect(await committed(store)).toBe(0);
  });

  it('releases the reservation when the provider would not take the call', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(retryable());
    expect(await placeCall(deps, INPUT, 0)).toMatchObject({ outcome: 'retry_later' });
    // No call happened, so the next attempt should find the budget where it was.
    expect(await committed(store)).toBe(0);
  });

  it('lets several calls run at once without any of them crossing the line', async () => {
    const { deps, store } = makeDeps({ monthlyCapUsd: 1 });
    for (const id of ['res-1', 'res-2', 'res-3', 'res-4']) await store.createResident(resident(id));
    const results = await Promise.all(
      ['res-1', 'res-2', 'res-3', 'res-4'].map((residentId) => placeCall(deps, { ...INPUT, residentId }, 0)),
    );
    const placed = results.filter((r) => r.outcome === 'placed').length;
    expect(placed).toBeGreaterThan(0);
    expect(results.filter((r) => r.outcome === 'skipped')).not.toHaveLength(0);
    expect(await committed(store)).toBeLessThanOrEqual(Math.floor(deps.config.spend.policy.capMicros * 0.9));
  });
});

describe('placeCall', () => {
  it('places the call and records the Twilio Call SID', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1'));
    const r = await placeCall(deps, INPUT, 0);
    expect(r).toEqual({ outcome: 'placed', providerCallId: expect.stringMatching(/^CA/) });
    const req = telephony.calls[0]!;
    expect(req).toMatchObject({ to: '+819000000001', from: '+15005550006', ringTimeoutSec: 30, maxCallSec: 480 });
    expect(req.statusCallbackUrl).toBe(`${BASE_URL}/twilio/status?residentId=res-1&callId=2026-10-02-0`);
    expect(req.twiml).toContain('<Say');
    expect(req.twiml).toContain('Hachi, an AI assistant');
    const call = (await store.getCall('res-1', callIdFor('2026-10-02', 0)))!;
    expect(call).toMatchObject({ status: 'scheduled', attempt: 0, localDate: '2026-10-02', source: 'live', channel: 'pstn' });
    expect(call.providerCallId).toBe(r.outcome === 'placed' ? r.providerCallId : '');
    expect(call.dialLease).toBeUndefined();
  });

  it('bridges to the Voice Gateway when a stream URL is configured', async () => {
    const { deps, store, telephony } = makeDeps({ voiceStreamUrl: 'wss://gateway.example/stream' });
    await store.createResident(resident('res-1'));
    await placeCall(deps, INPUT, 0);
    const twiml = telephony.calls[0]!.twiml;
    const call = (await store.getCall('res-1', '2026-10-02-0'))!;
    expect(twiml).toContain('<Stream url="wss://gateway.example/stream">');
    expect(twiml).toContain('<Parameter name="callId" value="2026-10-02-0"/>');
    expect(call.streamToken).toMatch(/^token-/);
    expect(twiml).toContain(`<Parameter name="streamToken" value="${call.streamToken}"/>`);
    expect(twiml).toContain(`<Redirect method="POST">${BASE_URL}/twilio/after-stream?residentId=res-1&amp;callId=2026-10-02-0</Redirect>`);
  });

  it('keeps the stream token when a stale lease is taken over', async () => {
    const { deps, store, telephony, clock } = makeDeps({ voiceStreamUrl: 'wss://gateway.example/stream' });
    await store.createResident(resident('res-1'));
    await store.createCallIfAbsent({
      id: '2026-10-02-0',
      residentId: 'res-1',
      source: 'live',
      status: 'scheduled',
      channel: 'pstn',
      startedAt: NOW.toISOString(),
      analysisPending: false,
      createdAt: NOW.toISOString(),
      dialLease: { token: 'other', at: NOW.toISOString() },
      streamToken: 'original',
    });
    clock.now = new Date(NOW.getTime() + DIAL_LEASE_MS + 1);
    await placeCall(deps, INPUT, 1);
    expect(telephony.calls[0]!.twiml).toContain('value="original"');
  });

  it('skips inactive or deleted residents', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1', { active: false }));
    expect(await placeCall(deps, INPUT, 0)).toEqual({ outcome: 'skipped', reason: 'inactive' });
    expect(await placeCall(deps, { ...INPUT, residentId: 'gone' }, 0)).toEqual({ outcome: 'skipped', reason: 'inactive' });
    expect(telephony.calls).toHaveLength(0);
  });

  it('never dials twice when the task is delivered again (at-least-once delivery)', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1'));
    await placeCall(deps, INPUT, 0);
    expect(await placeCall(deps, INPUT, 1)).toEqual({ outcome: 'skipped', reason: 'already_handled' });
    expect(telephony.calls).toHaveLength(1);
  });

  it('backs off while another worker holds the dial lease, then takes over once it expires', async () => {
    const { deps, store, telephony, clock } = makeDeps();
    await store.createResident(resident('res-1'));
    await store.createCallIfAbsent({
      id: '2026-10-02-0',
      residentId: 'res-1',
      source: 'live',
      status: 'scheduled',
      channel: 'pstn',
      startedAt: NOW.toISOString(),
      analysisPending: false,
      createdAt: NOW.toISOString(),
      attempt: 0,
      localDate: '2026-10-02',
      dialLease: { token: 'other-worker', at: NOW.toISOString() },
    });
    expect(await placeCall(deps, INPUT, 1)).toEqual({ outcome: 'retry_later', reason: 'dial_in_progress' });
    expect(telephony.calls).toHaveLength(0);
    clock.now = new Date(NOW.getTime() + DIAL_LEASE_MS + 1);
    expect((await placeCall(deps, INPUT, 2)).outcome).toBe('placed');
    expect(telephony.calls).toHaveLength(1);
  });

  it('skips a call that already ended', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(unverified());
    await placeCall(deps, INPUT, 0);
    telephony.next = null;
    expect(await placeCall(deps, INPUT, 1)).toEqual({ outcome: 'skipped', reason: 'already_handled' });
  });

  it('asks Cloud Tasks to retry a temporary Twilio failure and releases the lease', async () => {
    const { deps, store, telephony, queue } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(retryable());
    expect(await placeCall(deps, INPUT, 0)).toEqual({ outcome: 'retry_later', reason: 'provider_unavailable' });
    const call = (await store.getCall('res-1', '2026-10-02-0'))!;
    expect(call.status).toBe('scheduled');
    expect(call.dialLease).toBeUndefined();
    expect(queue.tasks).toHaveLength(0);

    telephony.next = null;
    expect((await placeCall(deps, INPUT, 1)).outcome).toBe('placed');
  });

  it('treats unexpected errors as temporary', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(new Error('socket hang up'));
    expect((await placeCall(deps, INPUT, 0)).outcome).toBe('retry_later');
  });

  it('after repeated temporary failures marks the attempt failed and schedules the next attempt', async () => {
    const { deps, store, telephony, queue } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(retryable());
    expect(await placeCall(deps, INPUT, PLACEMENT_RETRIES)).toEqual({ outcome: 'failed', retryScheduled: true });
    expect((await store.getCall('res-1', '2026-10-02-0'))!.failure).toEqual({ message: 'Twilio 503: Service Unavailable', retryable: true });
    expect(queue.tasks).toEqual([
      {
        name: 'call-res-1-2026-10-02-1',
        path: '/tasks/place-call',
        body: { residentId: 'res-1', localDate: '2026-10-02', attempt: 1 },
        scheduleAt: new Date(NOW.getTime() + 180_000),
      },
    ]);
  });

  it('stops retrying after the last attempt', async () => {
    const { deps, store, telephony, queue } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(retryable());
    expect(await placeCall(deps, { ...INPUT, attempt: 2 }, PLACEMENT_RETRIES)).toEqual({ outcome: 'failed', retryScheduled: false });
    expect(queue.tasks).toHaveLength(0);
  });

  it('does not retry permanent errors such as an unverified number on a trial account', async () => {
    const { deps, store, telephony, queue } = makeDeps();
    await store.createResident(resident('res-1'));
    telephony.failWith(unverified());
    expect(await placeCall(deps, INPUT, 0)).toEqual({ outcome: 'failed', retryScheduled: false, code: '21219' });
    const call = (await store.getCall('res-1', '2026-10-02-0'))!;
    expect(call).toMatchObject({ status: 'failed', failure: { code: '21219', retryable: false } });
    expect(call.endedAt).toBe(NOW.toISOString());
    expect(queue.tasks).toHaveLength(0);
  });
});

describe('applyCallStatus', () => {
  async function placed() {
    const ctx = makeDeps();
    await ctx.store.createResident(resident('res-1'));
    const r = await placeCall(ctx.deps, INPUT, 0);
    const sid = r.outcome === 'placed' ? r.providerCallId : '';
    return { ...ctx, sid, ids: { residentId: 'res-1', callId: '2026-10-02-0' } };
  }

  it('moves through answered and completed, recording the duration', async () => {
    const { deps, store, sid, ids } = await placed();
    expect(await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'ringing' })).toEqual({ status: 'scheduled', retryScheduled: false });
    expect((await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'in-progress' })).status).toBe('in_progress');
    expect((await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'completed', CallDuration: '214' })).status).toBe('completed');
    expect(await store.getCall('res-1', ids.callId)).toMatchObject({ status: 'completed', durationSec: 214, endedAt: NOW.toISOString() });
  });

  it('records the Call SID if the callback arrives before our own write', async () => {
    const { deps, store } = makeDeps();
    await store.createResident(resident('res-1'));
    await store.createCallIfAbsent({
      id: 'c',
      residentId: 'res-1',
      source: 'live',
      status: 'scheduled',
      channel: 'pstn',
      startedAt: NOW.toISOString(),
      analysisPending: false,
      createdAt: NOW.toISOString(),
      dialLease: { token: 't', at: NOW.toISOString() },
    });
    await applyCallStatus(deps, { residentId: 'res-1', callId: 'c' }, { CallSid: 'CA1', CallStatus: 'initiated' });
    const call = (await store.getCall('res-1', 'c'))!;
    expect(call.providerCallId).toBe('CA1');
    expect(call.dialLease).toBeUndefined();
  });

  it('records busy and no-answer without retrying', async () => {
    for (const s of ['busy', 'no-answer']) {
      const { deps, sid, ids, queue } = await placed();
      expect(await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: s })).toEqual({ status: 'no_answer', retryScheduled: false });
      expect(queue.tasks).toHaveLength(0);
    }
  });

  it('retries once when the call fails for technical reasons', async () => {
    for (const s of ['failed', 'canceled']) {
      const { deps, store, sid, ids, queue } = await placed();
      expect(await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: s, ErrorCode: '31005' })).toEqual({ status: 'failed', retryScheduled: true });
      expect((await store.getCall('res-1', ids.callId))!.failure).toEqual({ code: '31005', message: `Twilio reported ${s}`, retryable: true });
      expect(await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: s })).toEqual({ status: 'failed', retryScheduled: false });
      expect(queue.tasks.map((t) => t.name)).toEqual(['call-res-1-2026-10-02-1']);
    }
  });

  it('never overwrites a terminal state with a late callback', async () => {
    const { deps, sid, ids } = await placed();
    await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'completed', CallDuration: '60' });
    expect((await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'in-progress' })).status).toBe('completed');
    expect((await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'failed' })).status).toBe('completed');
  });

  it('ignores callbacks for a different Call SID and unknown statuses', async () => {
    const { deps, sid, ids } = await placed();
    expect((await applyCallStatus(deps, ids, { CallSid: 'CAother', CallStatus: 'completed' })).status).toBe('scheduled');
    expect((await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'mystery' })).status).toBe('scheduled');
    expect((await applyCallStatus(deps, ids, {})).status).toBe('scheduled');
  });

  it('keeps durationSec unset when Twilio omits it', async () => {
    const { deps, store, sid, ids } = await placed();
    await applyCallStatus(deps, ids, { CallSid: sid, CallStatus: 'completed' });
    expect((await store.getCall('res-1', ids.callId))!.durationSec).toBeUndefined();
  });

  it('fails loudly for an unknown call', async () => {
    const { deps } = makeDeps();
    await expect(applyCallStatus(deps, { residentId: 'res-1', callId: 'nope' }, { CallStatus: 'completed' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
