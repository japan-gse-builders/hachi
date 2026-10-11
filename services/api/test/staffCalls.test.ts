import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import { charge, DEFAULT_GATEWAY_POLICY, parseSpendSettings, spendMonth, USD } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { call, makeResident, NOW, setup, storedCase } from './helpers.js';

/** Issue #13: staff ask Hachi to call a resident now. NOW is 12:00 on 2026-10-01 in Tokyo. */

class FakeQueue implements TaskQueue {
  readonly tasks: EnqueueRequest[] = [];
  fail = false;
  async enqueue(req: EnqueueRequest): Promise<'created' | 'exists'> {
    if (this.fail) throw new Error('tasks unavailable');
    this.tasks.push(req);
    return 'created';
  }
}

const COOLDOWN_MS = 10 * 60_000;
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

async function seeded(opts: Parameters<typeof setup>[0] = {}, residentOverrides: Record<string, unknown> = {}) {
  const queue = new FakeQueue();
  const ctx = setup({ calls: { queue, cooldownMs: COOLDOWN_MS }, ...opts });
  await ctx.store.createResident(makeResident('res-1'));
  // Applied after creation: the input schema would drop fields staff cannot set.
  await ctx.store.updateResident('res-1', (r) => ({ ...r, ...residentOverrides }));
  const callNow = (who: Parameters<typeof ctx.as>[0] = 'staff') => ctx.app.inject({ method: 'POST', url: '/api/residents/res-1/calls', ...ctx.as(who) });
  const progress = (callId: string, who: Parameters<typeof ctx.as>[0] = 'staff') =>
    ctx.app.inject({ method: 'GET', url: `/api/residents/res-1/calls/${callId}`, ...ctx.as(who) });
  /** What the telephony service does when the call ends. */
  const endCall = () => ctx.store.updateResident('res-1', ({ callSlot: _slot, ...r }) => r);
  return { ...ctx, queue, callNow, progress, endCall };
}

describe('asking Hachi to call now (issue #13)', () => {
  it('is staff only', async () => {
    const ctx = await seeded();
    expect((await ctx.callNow('familyPhone')).statusCode).toBe(403);
    expect((await ctx.callNow(null)).statusCode).toBe(401);
    expect((await ctx.progress('2026-10-01-now-1', 'familyPhone')).statusCode).toBe(403);
    expect(ctx.queue.tasks).toEqual([]);
  });

  it('queues a dial task for the telephony service under the staff series, and holds the line', async () => {
    const ctx = await seeded();
    const res = await ctx.callNow();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ callId: '2026-10-01-now-1', status: 'requested' });
    expect(ctx.queue.tasks).toEqual([
      {
        name: 'call-res-1-2026-10-01-now-1',
        path: '/tasks/place-call',
        body: { residentId: 'res-1', localDate: '2026-10-01', attempt: 0, staff: { seq: 1, requestedBy: 'staff-1' } },
      },
    ]);
    const r = (await ctx.store.getResident('res-1'))!;
    expect(r.callSlot).toEqual({ callId: '2026-10-01-now-1', at: NOW.toISOString(), until: later(5 * 60_000) });
    expect(r.lastStaffCall).toEqual({ callId: '2026-10-01-now-1', at: NOW.toISOString(), requestedBy: 'staff-1' });
  });

  it('refuses while another call holds the line, and says which one', async () => {
    const ctx = await seeded({}, { callSlot: { callId: '2026-10-01-0', at: NOW.toISOString(), until: later(60_000) } });
    const res = await ctx.callNow();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ reason: 'call_in_progress', callId: '2026-10-01-0' });
    expect(ctx.queue.tasks).toEqual([]);
  });

  it('gives one call between two members of staff pressing at once', async () => {
    const ctx = await seeded();
    const codes = (await Promise.all([ctx.callNow(), ctx.callNow()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([202, 409]);
    expect(ctx.queue.tasks).toHaveLength(1);
  });

  it('spaces requests out by the cooldown, then numbers the next call of the day', async () => {
    const ctx = await seeded();
    await ctx.callNow();
    await ctx.endCall();
    const soon = await ctx.callNow();
    expect(soon.statusCode).toBe(429);
    expect(soon.json()).toMatchObject({ reason: 'cooldown', retryAfterSec: 600 });
    expect(soon.headers['retry-after']).toBe('600');

    const after = await seeded();
    await after.callNow();
    await after.endCall();
    await after.store.updateResident('res-1', (r) => ({ ...r, lastStaffCall: { ...r.lastStaffCall!, at: later(-COOLDOWN_MS) } }));
    expect((await after.callNow()).json()).toEqual({ callId: '2026-10-01-now-2', status: 'requested' });
  });

  it.each([
    ['consent_required', { callConsent: undefined }],
    ['paused', { active: false }],
    ['synthetic', { synthetic: true }],
  ])('refuses with the reason %s, as the daily call would', async (reason, overrides) => {
    const ctx = await seeded({}, overrides);
    const res = await ctx.callNow();
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe(reason);
    expect(ctx.queue.tasks).toEqual([]);
    expect((await ctx.store.getResident('res-1'))!.callSlot).toBeUndefined();
  });

  it('refuses when the month’s AI budget is used up', async () => {
    const ctx = await seeded({ spend: parseSpendSettings({ AI_MONTHLY_CAP_USD: '100' }) });
    await ctx.store.mutateSpendLedger(spendMonth(NOW), (l) => charge(l, 95 * USD, NOW));
    const res = await ctx.callNow();
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('budget_exhausted');
  });

  it('refuses when the conversation is known to be broken', async () => {
    const ctx = await seeded({ gateway: DEFAULT_GATEWAY_POLICY });
    await ctx.store.mutateGatewayBreaker(() => ({ failures: 1, fault: 'systemic', lastFailedAt: NOW.toISOString(), updatedAt: NOW.toISOString() }));
    const res = await ctx.callNow();
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('gateway_unavailable');
  });

  it('does not hold staff to the cooldown after a call that went wrong on our side', async () => {
    const ctx = await seeded();
    await ctx.callNow();
    await ctx.store.addCalls([
      call({ id: '2026-10-01-now-1', status: 'failed', trigger: 'staff', requestedBy: 'staff-1', failure: { code: 'line_busy', message: 'busy', retryable: false } }),
    ]);
    await ctx.endCall();
    expect((await ctx.callNow()).json()).toEqual({ callId: '2026-10-01-now-2', status: 'requested' });
  });

  it('still spaces out a call that rang and was not answered', async () => {
    const ctx = await seeded();
    await ctx.callNow();
    await ctx.store.addCalls([call({ id: '2026-10-01-now-1', status: 'no_answer', trigger: 'staff', requestedBy: 'staff-1', durationSec: undefined })]);
    await ctx.endCall();
    expect((await ctx.callNow()).statusCode).toBe(429);
  });

  it('does not hold staff to the cooldown when the request never reached the telephony service', async () => {
    const ctx = await seeded();
    await ctx.callNow();
    // The line the request held has lapsed and no call was ever created.
    await ctx.store.updateResident('res-1', ({ callSlot: _slot, ...r }) => ({ ...r, lastStaffCall: { ...r.lastStaffCall!, at: later(-6 * 60_000) } }));
    expect((await ctx.callNow()).json()).toEqual({ callId: '2026-10-01-now-2', status: 'requested' });
  });

  it('frees the line and the cooldown when the task cannot be queued', async () => {
    const ctx = await seeded();
    ctx.queue.fail = true;
    const res = await ctx.callNow();
    expect(res.statusCode).toBe(503);
    const r = (await ctx.store.getResident('res-1'))!;
    expect(r.callSlot).toBeUndefined();
    expect(r.lastStaffCall).toBeUndefined();
    ctx.queue.fail = false;
    expect((await ctx.callNow()).statusCode).toBe(202);
  });

  it('answers 503 on a server that has no dial queue', async () => {
    const ctx = setup();
    await ctx.store.createResident(makeResident('res-1'));
    const res = await ctx.app.inject({ method: 'POST', url: '/api/residents/res-1/calls', ...ctx.as('staff') });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('not_configured');
  });

  it('answers 404 for an unknown resident', async () => {
    const ctx = await seeded();
    expect((await ctx.app.inject({ method: 'POST', url: '/api/residents/nobody/calls', ...ctx.as('staff') })).statusCode).toBe(404);
  });

  describe('following the call', () => {
    it('reads as requested until the telephony service has created the call, then follows it', async () => {
      const ctx = await seeded();
      await ctx.callNow();
      expect((await ctx.progress('2026-10-01-now-1')).json()).toMatchObject({ status: 'requested', trigger: 'staff', requestedBy: 'staff-1' });
      await ctx.store.addCalls([call({ id: '2026-10-01-now-1', status: 'in_progress', trigger: 'staff', requestedBy: 'staff-1', durationSec: undefined, endedAt: undefined })]);
      expect((await ctx.progress('2026-10-01-now-1')).json()).toMatchObject({ id: '2026-10-01-now-1', status: 'in_progress', trigger: 'staff', durationSec: null });
    });

    it('stops reading as requested once the request has lapsed without a call', async () => {
      const ctx = await seeded();
      await ctx.callNow();
      await ctx.store.updateResident('res-1', (r) => ({ ...r, lastStaffCall: { ...r.lastStaffCall!, at: later(-6 * 60_000) } }));
      expect((await ctx.progress('2026-10-01-now-1')).json()).toMatchObject({ status: 'failed', failureCode: 'not_placed' });
    });

    it('answers 404 for a call that was never asked for', async () => {
      const ctx = await seeded();
      expect((await ctx.progress('2026-10-01-now-7')).statusCode).toBe(404);
      expect((await ctx.progress('bad.id')).statusCode).toBe(404);
    });
  });
});

describe('staff calls elsewhere on the staff screens', () => {
  it('say on the case page whether "Call now" can work for the resident', async () => {
    const { app, store, as } = setup();
    await store.createResident(makeResident('res-1'));
    await store.putCase(storedCase());
    const callable = async () => (await app.inject({ method: 'GET', url: '/api/cases/case-1', ...as('staff') })).json().resident.callable;
    expect(await callable()).toBe(true);
    await store.updateResident('res-1', (r) => ({ ...r, active: false }));
    expect(await callable()).toBe(false);
  });

  it('are marked on the case page with who asked', async () => {
    const { app, store, as } = setup();
    await store.createResident(makeResident('res-1'));
    await store.addCalls([call(), call({ id: '2026-10-01-now-1', startedAt: '2026-10-01T02:00:00.000Z', trigger: 'staff', requestedBy: 'staff-1' })]);
    await store.putCase(storedCase());
    const calls = (await app.inject({ method: 'GET', url: '/api/cases/case-1', ...as('staff') })).json().calls;
    expect(calls.find((c: { id: string }) => c.id === '2026-10-01-now-1')).toMatchObject({ trigger: 'staff', requestedBy: 'staff-1' });
    expect(calls.find((c: { id: string }) => c.id === 'call-1')).toMatchObject({ trigger: null, requestedBy: null });
  });

  it('do not count as a missed check-in when they did not connect, but count as reaching the resident when they did', async () => {
    const { app, store, as } = setup();
    await store.createResident(makeResident('res-1'));
    const unreached = async () => (await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') })).json().unreached.items;
    await store.addCalls([call({ id: '2026-10-01-now-1', localDate: '2026-10-01', status: 'no_answer', trigger: 'staff', requestedBy: 'staff-1' })]);
    expect(await unreached()).toEqual([]);
    await store.addCalls([
      call({ id: '2026-10-01-0', localDate: '2026-10-01', status: 'no_answer', startedAt: '2026-10-01T01:00:00.000Z' }),
      call({ id: '2026-10-01-now-2', localDate: '2026-10-01', status: 'completed', trigger: 'staff', requestedBy: 'staff-1', startedAt: '2026-10-01T02:00:00.000Z', conversation: { endedBy: 'agent', at: NOW.toISOString() } }),
    ]);
    expect(await unreached()).toEqual([]);
  });
});
