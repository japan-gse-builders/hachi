import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import { recordContactRequest } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { makeResident, NOW, setup } from './helpers.js';

/**
 * Anyone can create an organization and type in any number or address. Until Hachi has verified
 * who runs it, nothing it enters may reach a stranger: no calls, and none of its residents on a
 * family dashboard. (Messages are stopped by the notification worker; see services/notifier.)
 */

class FakeQueue implements TaskQueue {
  readonly tasks: EnqueueRequest[] = [];
  async enqueue(req: EnqueueRequest): Promise<'created' | 'exists'> {
    this.tasks.push(req);
    return 'created';
  }
}

async function seeded() {
  const queue = new FakeQueue();
  const ctx = setup({ calls: { queue, cooldownMs: 600_000 } });
  await ctx.store.createResident(makeResident('res-1'));
  // The same family contact, in a verified organization, to show only the unverified one is hidden.
  await ctx.store.createResident({ ...makeResident('res-2', { name: 'Hana Ito' }), orgId: 'org-2' });
  const unverify = () => ctx.store.updateOrganization('org-1', ({ verifiedAt: _a, verifiedBy: _b, ...o }) => o);
  const verify = () => ctx.store.updateOrganization('org-1', (o) => ({ ...o, verifiedAt: NOW.toISOString(), verifiedBy: 'operator' }));
  return { ...ctx, queue, unverify, verify };
}

describe('an organization Hachi has not verified', () => {
  it('is what a self-serve organization starts as, and staff are told', async () => {
    const { app, as } = setup();
    const created = await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: 'Kato Care', timeZone: 'Asia/Tokyo' } });
    expect(created.statusCode).toBe(201);
    const me = (await app.inject({ method: 'GET', url: '/api/me', ...as('newcomer') })).json();
    expect(me.memberships).toEqual([expect.objectContaining({ orgName: 'Kato Care', verified: false })]);
    const org = (await app.inject({ method: 'GET', url: '/api/organization', ...as('newcomer') })).json();
    expect(org.verified).toBe(false);
    const sakura = (await app.inject({ method: 'GET', url: '/api/organization', ...as('otherStaff') })).json();
    expect(sakura.verified).toBe(true);
  });

  it('can invite people, but the invitee is told Hachi does not know who it is', async () => {
    const { app, as, store } = setup();
    await store.updateOrganization('org-2', ({ verifiedAt: _a, verifiedBy: _b, ...o }) => o);
    const invite = (who: 'outsider' | 'staff') =>
      app.inject({ method: 'POST', url: '/api/organization/invitations', ...as(who), payload: { email: 'kato@example.org' } });
    expect((await invite('outsider')).statusCode).toBe(201);
    expect((await invite('staff')).statusCode).toBe(201);
    const me = (await app.inject({ method: 'GET', url: '/api/me', ...as('newcomer') })).json();
    expect(me.invitations.map((i: { orgName: string; orgVerified: boolean }) => [i.orgName, i.orgVerified]).sort()).toEqual([
      ['Elsewhere Care', false],
      ['Sakura Care', true],
    ]);
  });

  it('cannot be verified by its own staff', async () => {
    const { app, as, store, unverify } = await seeded();
    await unverify();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/organization',
      ...as('staff'),
      payload: { name: 'Sakura Care', verifiedAt: NOW.toISOString(), verifiedBy: 'staff-1' },
    });
    expect(res.statusCode).toBe(400);
    expect((await store.getOrganization('org-1'))!.verifiedAt).toBeUndefined();
    // Renaming keeps a verification that is there.
    const verified = await seeded();
    await verified.app.inject({ method: 'PATCH', url: '/api/organization', ...verified.as('staff'), payload: { name: 'Sakura Home Care' } });
    expect((await verified.store.getOrganization('org-1'))!.verifiedAt).toBeDefined();
  });

  it('cannot ask Hachi to call a resident now, and holds nothing for the attempt', async () => {
    const { app, as, store, queue, unverify, verify } = await seeded();
    await unverify();
    const res = await app.inject({ method: 'POST', url: '/api/residents/res-1/calls', ...as('staff') });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('organization_unverified');
    expect(queue.tasks).toEqual([]);
    const r = (await store.getResident('res-1'))!;
    expect(r.callSlot).toBeUndefined();
    expect(r.lastStaffCall).toBeUndefined();

    await verify();
    expect((await app.inject({ method: 'POST', url: '/api/residents/res-1/calls', ...as('staff') })).statusCode).toBe(202);
  });

  it('does not put its residents on any family dashboard', async () => {
    const { app, as, unverify } = await seeded();
    const list = async () => (await app.inject({ method: 'GET', url: '/api/family/residents', ...as('familyPhone') })).json().residents;
    expect(await list()).toEqual([
      { id: 'res-1', name: 'Margaret Smith', portrait: null },
      { id: 'res-2', name: 'Hana Ito', portrait: null },
    ]);
    await unverify();
    expect(await list()).toEqual([{ id: 'res-2', name: 'Hana Ito', portrait: null }]);
    const dashboard = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyPhone') });
    expect(dashboard.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/family/residents/res-2/dashboard', ...as('familyPhone') })).statusCode).toBe(200);
  });

  it('shows family none of its held messages, and family cannot decide them', async () => {
    const { app, as, store, unverify } = await seeded();
    const entry = (await recordContactRequest(store, (await store.getResident('res-1'))!, 'call-1', { who: 'Susan', number: '+819011112222', confirmed: true, turn: 3 }, NOW))!;
    await unverify();
    const listed = await app.inject({ method: 'GET', url: '/api/family/contact-requests', ...as('familyPhone') });
    expect(listed.json().requests).toEqual([]);
    const decided = await app.inject({ method: 'POST', url: `/api/family/contact-requests/${entry.id}`, ...as('familyPhone'), payload: { decision: 'approve' } });
    expect(decided.statusCode).toBe(404);
    expect((await store.getOutbox(entry.id))!.status).toBe('awaiting_approval');
    // Its own staff still see and decide them; the notification worker sends nothing either way.
    expect((await app.inject({ method: 'GET', url: '/api/contact-requests', ...as('staff') })).json().requests).toHaveLength(1);
  });

  it('does not collect family push tokens for its residents', async () => {
    const { app, as, store, unverify } = await seeded();
    await unverify();
    const res = await app.inject({ method: 'POST', url: '/api/family/push-tokens', ...as('familyPhone'), payload: { token: 'fcm-token-abcdef' } });
    expect(res.statusCode).toBe(204);
    expect((await store.getResident('res-1'))!.family?.pushTokens ?? []).toEqual([]);
    expect((await store.getResident('res-2'))!.family?.pushTokens).toEqual(['fcm-token-abcdef']);
  });
});
