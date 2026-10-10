import { spendMonth } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { afterStream, MAX_STREAMS } from '../src/bridge.js';
import { staffCallTask } from '@hachi/cloud';
import { applyCallStatus, LINE_BUSY_RECHECK_SEC, parsePlaceCallInput, placeCall, PLACE_CALL_PATH } from '../src/calls.js';
import { makeDeps, NOW, resident, unverified } from './fixtures.js';

/** Issue #13: staff ask Hachi to call a resident now, through the same path as the daily check-in. */

const daily = { residentId: 'res-1', localDate: '2026-10-02', attempt: 0 };
const staff = { ...daily, staff: { seq: 1, requestedBy: 'staff-1' } };
const STAFF_ID = '2026-10-02-now-1';

/** What the API does before the task runs: hold the line for this call. */
async function seeded(overrides: Parameters<typeof makeDeps>[0] = {}, residentOverrides = {}) {
  const ctx = makeDeps(overrides);
  await ctx.store.createResident(
    resident('res-1', {
      callSlot: { callId: STAFF_ID, at: NOW.toISOString(), until: new Date(NOW.getTime() + 300_000).toISOString() },
      ...residentOverrides,
    }),
  );
  return ctx;
}

describe('parsePlaceCallInput with a staff request', () => {
  it('accepts a staff request and rejects a malformed one', () => {
    expect(parsePlaceCallInput(staff, 3)).toEqual(staff);
    for (const bad of [
      { ...staff, staff: { seq: 0, requestedBy: 'staff-1' } },
      { ...staff, staff: { seq: 1.5, requestedBy: 'staff-1' } },
      { ...staff, staff: { seq: 1, requestedBy: 'a/b' } },
      { ...staff, staff: { seq: 1 } },
      { ...staff, staff: null },
      { ...staff, attempt: 1 },
    ]) {
      expect(parsePlaceCallInput(bad, 3)).toBeNull();
    }
  });

  it('reads the task the API builds, which is named after the staff series rather than the daily one', () => {
    const task = staffCallTask('res-1', '2026-10-02', 1, 'staff-1');
    expect(task).toMatchObject({ name: 'call-res-1-2026-10-02-now-1', path: PLACE_CALL_PATH });
    expect(parsePlaceCallInput(task.body, 3)).toEqual(staff);
  });
});

describe('a staff-requested call', () => {
  it('dials under its own id, records who asked, and holds the line for the length of a call', async () => {
    const { deps, store, telephony } = await seeded();
    expect((await placeCall(deps, staff, 0)).outcome).toBe('placed');
    expect(telephony.calls).toHaveLength(1);
    const c = (await store.getCall('res-1', STAFF_ID))!;
    expect(c).toMatchObject({ trigger: 'staff', requestedBy: 'staff-1', localDate: '2026-10-02', status: 'scheduled' });
    expect(c.attempt).toBeUndefined();
    const slot = (await store.getResident('res-1'))!.callSlot!;
    expect(slot.callId).toBe(STAFF_ID);
    // ring 30 s + call 480 s + 60 s of headroom
    expect(Date.parse(slot.until) - NOW.getTime()).toBe(570_000);
  });

  it('goes through the same budget check as the daily call', async () => {
    const { deps, store, telephony } = await seeded({ monthlyCapUsd: 0.000001 });
    expect(await placeCall(deps, staff, 0)).toEqual({ outcome: 'skipped', reason: 'budget_exhausted' });
    expect(telephony.calls).toHaveLength(0);
    expect((await store.getCall('res-1', STAFF_ID))!.failure!.code).toBe('budget_exhausted');
    expect((await store.getResident('res-1'))!.callSlot).toBeUndefined();
  });

  it('goes through the same approval check, and never rings a synthetic resident', async () => {
    const noConsent = await seeded({}, { callConsent: undefined });
    expect(await placeCall(noConsent.deps, staff, 0)).toEqual({ outcome: 'skipped', reason: 'consent_required' });
    const demo = await seeded({}, { synthetic: true });
    expect(await placeCall(demo.deps, staff, 0)).toEqual({ outcome: 'skipped', reason: 'synthetic' });
    expect(noConsent.telephony.calls.length + demo.telephony.calls.length).toBe(0);
  });

  it.each([
    ['inactive', 'paused', { active: false }],
    ['consent_required', 'consent_required', { callConsent: undefined }],
    ['synthetic', 'synthetic', { synthetic: true }],
  ])('when refused (%s), says why on the call and frees the line at once', async (_reason, code, overrides) => {
    const { deps, store } = await seeded({}, overrides);
    await placeCall(deps, staff, 0);
    expect((await store.getCall('res-1', STAFF_ID))!).toMatchObject({ status: 'failed', trigger: 'staff', failure: { code, retryable: false } });
    expect((await store.getResident('res-1'))!.callSlot).toBeUndefined();
  });

  it('leaves a call already made alone when its task comes again after calls were paused', async () => {
    const { deps, store } = await seeded();
    expect((await placeCall(deps, staff, 0)).outcome).toBe('placed');
    await store.updateResident('res-1', (r) => ({ ...r, active: false }));
    expect(await placeCall(deps, staff, 1)).toEqual({ outcome: 'skipped', reason: 'inactive' });
    expect((await store.getCall('res-1', STAFF_ID))!.status).toBe('scheduled');
    expect((await store.getResident('res-1'))!.callSlot?.callId).toBe(STAFF_ID);
  });

  it('is not retried when Twilio refuses it, and frees the line', async () => {
    const { deps, store, queue, telephony } = await seeded();
    telephony.failWith(unverified());
    expect(await placeCall(deps, staff, 0)).toMatchObject({ outcome: 'failed', retryScheduled: false });
    expect(queue.tasks).toEqual([]);
    expect((await store.getResident('res-1'))!.callSlot).toBeUndefined();
  });

  it('is not retried when it fails during the call, and frees the line when it ends', async () => {
    const { deps, store, queue } = await seeded();
    await placeCall(deps, staff, 0);
    const ids = { residentId: 'res-1', callId: STAFF_ID };
    expect(await applyCallStatus(deps, ids, { CallStatus: 'failed' })).toEqual({ status: 'failed', retryScheduled: false });
    expect(queue.tasks).toEqual([]);
    expect((await store.getResident('res-1'))!.callSlot).toBeUndefined();
  });

  it('does not promise a call back when the conversation cannot continue', async () => {
    const { deps, store, queue } = await seeded({ voiceStreamUrl: 'wss://gateway.example/stream' });
    await placeCall(deps, staff, 0);
    await store.updateCall('res-1', STAFF_ID, (c) => ({ ...c, status: 'in_progress', streams: MAX_STREAMS }));
    const twiml = await afterStream(deps, { residentId: 'res-1', callId: STAFF_ID });
    expect(twiml).not.toContain('call you back');
    expect(twiml).toContain('care team');
    expect(queue.tasks).toEqual([]);
    expect((await store.getCall('res-1', STAFF_ID))!.failure!.retryable).toBe(false);
  });

  it('gives up if the line was taken by another call after the request expired', async () => {
    const { deps, store, telephony } = await seeded({}, {
      callSlot: { callId: '2026-10-02-0', at: NOW.toISOString(), until: new Date(NOW.getTime() + 60_000).toISOString() },
    });
    expect(await placeCall(deps, staff, 0)).toEqual({ outcome: 'skipped', reason: 'line_busy' });
    expect(telephony.calls).toHaveLength(0);
    expect((await store.getCall('res-1', STAFF_ID))!.failure!.code).toBe('line_busy');
    expect((await store.getResident('res-1'))!.callSlot!.callId).toBe('2026-10-02-0');
  });
});

describe('the daily check-in on a day staff asked for a call', () => {
  it('waits for a staff call that is still going instead of ringing into it, without using an attempt', async () => {
    const { deps, store, queue, telephony } = await seeded();
    await placeCall(deps, staff, 0);
    expect(await placeCall(deps, daily, 0)).toEqual({ outcome: 'deferred', reason: 'line_busy' });
    expect(telephony.calls).toHaveLength(1);
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0]).toMatchObject({ path: PLACE_CALL_PATH, body: daily });
    expect(queue.tasks[0]!.name).toMatch(/^call-res-1-2026-10-02-0-wait-\d+$/);
    expect(queue.tasks[0]!.scheduleAt!.getTime() - NOW.getTime()).toBe(LINE_BUSY_RECHECK_SEC * 1000);
    const waiting = (await store.getCall('res-1', '2026-10-02-0'))!;
    expect(waiting).toMatchObject({ status: 'scheduled', attempt: 0 });
    expect(waiting.dialLease).toBeUndefined();
    // Nothing is held against the month for a call that has not rung.
    expect((await store.getSpendLedger(spendMonth(NOW)))!.leases.map((l) => l.id)).toEqual([`call:res-1/${STAFF_ID}`]);
  });

  it('rings as usual under its own id once the staff call has ended', async () => {
    const { deps, store, telephony } = await seeded();
    await placeCall(deps, staff, 0);
    await placeCall(deps, daily, 0);
    await applyCallStatus(deps, { residentId: 'res-1', callId: STAFF_ID }, { CallStatus: 'completed', CallDuration: '200' });
    expect((await placeCall(deps, daily, 0)).outcome).toBe('placed');
    expect(telephony.calls).toHaveLength(2);
    expect((await store.listCalls('res-1')).map((c) => c.id).sort()).toEqual(['2026-10-02-0', STAFF_ID]);
  });
});
