import { spendMonth } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { emergencyTransfer } from '../src/bridge.js';
import { dispatchDueCalls, placeCall } from '../src/calls.js';
import { makeDeps, NOW, organization, resident } from './fixtures.js';

/** A self-serve organization can enter anyone's number; Hachi rings nobody for it until verified. */

const daily = { residentId: 'res-1', localDate: '2026-10-02', attempt: 0 };
const STAFF_ID = '2026-10-02-now-1';
const staff = { ...daily, staff: { seq: 1, requestedBy: 'staff-1' } };

function unverified() {
  const ctx = makeDeps();
  ctx.store.seedAccounts({ organizations: [organization('org-1', { verifiedAt: undefined, verifiedBy: undefined, billing: { plan: 'trial', email: 'b@example.org', limits: { residents: 5, members: 3 } } })] });
  return ctx;
}

describe('calls for an organization Hachi has not verified', () => {
  it('never dials the daily check-in, nor reserves money or the gateway for it', async () => {
    const { deps, store, telephony } = unverified();
    await store.createResident(resident('res-1'));
    expect(await placeCall(deps, daily, 0)).toEqual({ outcome: 'skipped', reason: 'organization_unverified' });
    expect(telephony.calls).toHaveLength(0);
    expect(await store.listCalls('res-1')).toEqual([]);
    expect(await store.getSpendLedger(spendMonth(NOW))).toBeNull();
    expect(await store.getGatewayBreaker()).toBeNull();
  });

  it('records a staff request as not made, says why, and frees the line', async () => {
    const { deps, store, telephony } = unverified();
    await store.createResident(
      resident('res-1', {
        callSlot: { callId: STAFF_ID, at: NOW.toISOString(), until: new Date(NOW.getTime() + 300_000).toISOString() },
        lastStaffCall: { callId: STAFF_ID, at: NOW.toISOString(), requestedBy: 'staff-1' },
      }),
    );
    expect(await placeCall(deps, staff, 0)).toEqual({ outcome: 'skipped', reason: 'organization_unverified' });
    expect(telephony.calls).toHaveLength(0);
    expect(await store.getCall('res-1', STAFF_ID)).toMatchObject({ status: 'failed', failure: { code: 'organization_unverified', retryable: false } });
    expect((await store.getResident('res-1'))!.callSlot).toBeUndefined();
  });

  it('does not ring a resident whose organization is missing or not yet recorded', async () => {
    const { deps, store, telephony } = makeDeps();
    await store.createResident(resident('res-1', { orgId: 'org-gone' }));
    await store.createResident(resident('res-2', { orgId: '' }));
    expect(await placeCall(deps, daily, 0)).toEqual({ outcome: 'skipped', reason: 'organization_unverified' });
    expect(await placeCall(deps, { ...daily, residentId: 'res-2' }, 0)).toEqual({ outcome: 'skipped', reason: 'organization_unverified' });
    expect(telephony.calls).toHaveLength(0);
  });

  it('does not even queue the daily check-in, while a verified organization’s resident is queued', async () => {
    const { deps, store, queue } = makeDeps();
    store.seedAccounts({ organizations: [organization('org-trial', { verifiedAt: undefined })] });
    await store.createResident(resident('res-trial', { orgId: 'org-trial' }));
    await store.createResident(resident('res-none', { orgId: '' }));
    await store.createResident(resident('res-1'));
    const result = await dispatchDueCalls(deps);
    expect(result.enqueued).toBe(1);
    expect(queue.tasks.map((t) => (t.body as { residentId: string }).residentId)).toEqual(['res-1']);
  });

  it('dials no family or staff for an emergency, whatever created the call', async () => {
    const { deps, store, telephony } = unverified();
    await store.createResident(resident('res-1', { family: { name: 'Ken', sms: '+819000000002' } }));
    await store.createCallIfAbsent({
      id: 'c-1', residentId: 'res-1', source: 'live', status: 'in_progress', channel: 'pstn',
      startedAt: NOW.toISOString(), createdAt: NOW.toISOString(), analysisPending: false,
      emergency: { at: NOW.toISOString(), caseId: 'case-1', quote: 'Please help' },
    });
    expect(await emergencyTransfer(deps, { residentId: 'res-1', callId: 'c-1' })).toEqual({ outcome: 'skipped', reason: 'organization_unverified' });
    expect(telephony.calls).toHaveLength(0);
  });

  it('rings as usual once verified, and stops again if verification is withdrawn', async () => {
    const { deps, store, telephony } = unverified();
    await store.createResident(resident('res-1'));
    expect((await placeCall(deps, daily, 0)).outcome).toBe('skipped');
    await store.updateOrganization('org-1', (o) => ({ ...o, verifiedAt: NOW.toISOString(), verifiedBy: 'operator' }));
    expect((await placeCall(deps, daily, 0)).outcome).toBe('placed');
    expect(telephony.calls).toHaveLength(1);

    await store.updateOrganization('org-1', ({ verifiedAt: _a, verifiedBy: _b, ...o }) => o);
    expect(await placeCall(deps, { ...daily, localDate: '2026-10-03' }, 0)).toEqual({ outcome: 'skipped', reason: 'organization_unverified' });
    expect(telephony.calls).toHaveLength(1);
  });
});
