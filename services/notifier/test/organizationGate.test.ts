import { describe, expect, it } from 'vitest';
import { deliver } from '../src/worker.js';
import { entry, setup } from './fixtures.js';

/** A self-serve organization can enter anyone's address; Hachi sends nothing for it until verified. */
describe('messages for an organization Hachi has not verified', () => {
  it('are skipped for good rather than sent or kept for later', async () => {
    const { deps, sms, store } = await setup({ organization: { verifiedAt: undefined, verifiedBy: undefined } });
    const e = entry();
    const out = await deliver(deps, e.id);
    expect(out).toEqual({ outcome: 'skipped', error: { code: 'organization_unverified', message: expect.any(String), retryable: false } });
    expect(sms.sent).toHaveLength(0);
    const stored = (await store.getOutbox(e.id))!;
    expect(stored).toMatchObject({ status: 'skipped', lastError: { code: 'organization_unverified' } });
    expect(stored.leaseUntil).toBeUndefined();
    // A later verification does not send a stale alert.
    await store.updateOrganization('org-1', (o) => ({ ...o, verifiedAt: '2026-10-02T04:00:00.000Z', verifiedBy: 'operator' }));
    expect(await deliver(deps, e.id)).toEqual({ outcome: 'done', status: 'skipped' });
    expect(sms.sent).toHaveLength(0);
    expect((await store.getCase('case-1'))!.notifications).toEqual([]);
  });

  it('are not sent when the organization does not exist', async () => {
    const e = entry({ orgId: 'org-gone' });
    const { deps, sms } = await setup({ entries: [e] });
    expect((await deliver(deps, e.id)).outcome).toBe('skipped');
    expect(sms.sent).toHaveLength(0);
  });

  it('without an organization of their own (written by an older service), follow their resident’s', async () => {
    const legacy = entry({ orgId: undefined as unknown as string });

    const verified = await setup({ entries: [legacy] });
    expect((await deliver(verified.deps, legacy.id)).outcome).toBe('sent');

    const unverified = await setup({ entries: [legacy], organization: { verifiedAt: undefined } });
    expect((await deliver(unverified.deps, legacy.id)).outcome).toBe('skipped');

    const orphan = await setup({ entries: [legacy], withResident: false });
    expect((await deliver(orphan.deps, legacy.id)).outcome).toBe('skipped');
    expect(orphan.sms.sent).toHaveLength(0);
  });

  it('go out as usual for a verified organization', async () => {
    const { deps, sms } = await setup();
    expect((await deliver(deps, entry().id)).outcome).toBe('sent');
    expect(sms.sent).toHaveLength(1);
  });
});
