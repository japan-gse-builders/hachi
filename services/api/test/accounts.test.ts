import { describe, expect, it } from 'vitest';
import type { Invitation } from '@hachi/store';
import { applyMemberChange, assertMayRemove, invitationGuard, TRIAL_LIMITS } from '../src/accounts.js';
import type { StaffPrincipal } from '../src/auth.js';
import { HttpError } from '../src/errors.js';
import { call, makeResident, membership, NOW, organization, residentInput, setup, storedCase } from './helpers.js';

type App = ReturnType<typeof setup>['app'];
type As = ReturnType<typeof setup>['as'];

const reasonOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.reason : 'other';
  }
  return undefined;
};

function principal(uid: string, role: StaffPrincipal['role']): StaffPrincipal {
  return { kind: 'staff', uid, email: `${uid}@example.org`, orgId: 'org-1', role, org: organization('org-1') };
}

function pendingInvitation(id: string, overrides: Partial<Invitation> = {}): Invitation {
  return {
    id,
    orgId: 'org-1',
    orgName: 'Sakura Care',
    email: 'kato@example.org',
    role: 'member',
    status: 'pending',
    invitedBy: { uid: 'staff-1', email: 'staff@example.org' },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    ...overrides,
  };
}

const invite = (app: App, as: As, token: string, email: string, role = 'member') =>
  app.inject({ method: 'POST', url: '/api/organization/invitations', ...as(token as never), payload: { email, role } });

describe('account rules', () => {
  const owner = membership('org-1', 'staff', 'owner');
  const admin = membership('org-1', 'admin', 'admin');
  const member = membership('org-1', 'otherStaff', 'member');
  const all = [owner, admin, member];
  const roster = (members: typeof all, pending: Invitation[] = []) => ({ members, pending });

  it('lets admins manage members, and only owners manage owners', () => {
    expect(applyMemberChange(principal('staff-3', 'admin'), member, { role: 'admin' }, roster(all), NOW).role).toBe('admin');
    expect(reasonOf(() => applyMemberChange(principal('staff-3', 'admin'), member, { role: 'owner' }, roster(all), NOW))).toBe('owner_only');
    expect(reasonOf(() => applyMemberChange(principal('staff-3', 'admin'), owner, { status: 'disabled' }, roster(all), NOW))).toBe('owner_only');
    expect(reasonOf(() => applyMemberChange(principal('staff-2', 'member'), admin, { status: 'disabled' }, roster(all), NOW))).toBe('forbidden_role');
    expect(applyMemberChange(principal('staff-1', 'owner'), admin, { role: 'owner' }, roster(all), NOW).role).toBe('owner');
  });

  it('refuses changes to yourself, and never leaves an organization without an active owner', () => {
    expect(reasonOf(() => applyMemberChange(principal('staff-1', 'owner'), owner, { role: 'admin' }, roster(all), NOW))).toBe('self');
    const second = membership('org-1', 'admin', 'owner');
    // Two owners: either may demote the other, but not the last one standing.
    expect(applyMemberChange(principal('staff-1', 'owner'), second, { role: 'admin' }, roster([owner, second]), NOW).role).toBe('admin');
    expect(reasonOf(() => assertMayRemove(principal('staff-1', 'owner'), owner, roster([owner, { ...second, status: 'disabled' }])))).toBe('last_owner');
    expect(reasonOf(() => assertMayRemove(principal('staff-1', 'owner'), owner, roster([owner, second])))).toBeUndefined();
    // Anyone may leave; only admins remove others.
    expect(reasonOf(() => assertMayRemove(principal('staff-2', 'member'), member, roster(all)))).toBeUndefined();
    expect(reasonOf(() => assertMayRemove(principal('staff-2', 'member'), admin, roster(all)))).toBe('forbidden_role');
  });

  it('turns access back on only when there is a free seat, counting pending invitations', () => {
    const off = { ...member, status: 'disabled' as const };
    const actor = (members: number) => ({ ...principal('staff-1', 'owner'), org: organization('org-1', { billing: { plan: 'trial', email: 'b@example.org', limits: { residents: 20, members } } }) });
    // Owner and admin hold 2 seats; the disabled member none.
    expect(applyMemberChange(actor(3), off, { status: 'active' }, roster([owner, admin, off]), NOW).status).toBe('active');
    expect(reasonOf(() => applyMemberChange(actor(3), off, { status: 'active' }, roster([owner, admin, off], [pendingInvitation('i1')]), NOW))).toBe('member_limit');
    expect(reasonOf(() => applyMemberChange(actor(2), off, { status: 'active' }, roster([owner, admin, off]), NOW))).toBe('member_limit');
    // Other changes to a disabled member, and turning access off, are never limited.
    expect(applyMemberChange(actor(2), off, { role: 'admin' }, roster([owner, admin, off]), NOW).role).toBe('admin');
    expect(applyMemberChange(actor(1), member, { status: 'disabled' }, roster(all), NOW).status).toBe('disabled');
  });

  it('refuses invitations to members, to the already invited, and beyond the member limit', () => {
    const guard = (email: string, limits = TRIAL_LIMITS) => (ctx: { members: typeof all; pending: Invitation[] }) => invitationGuard(email, limits)(ctx);
    expect(reasonOf(() => guard('sato@example.org')({ members: all, pending: [] }))).toBe('already_member');
    expect(reasonOf(() => guard('kato@example.org')({ members: all, pending: [pendingInvitation('i1')] }))).toBe('already_invited');
    expect(reasonOf(() => guard('new@example.org', { residents: 10, members: 4 })({ members: all, pending: [pendingInvitation('i1')] }))).toBe('member_limit');
    // A disabled member still holds their address but not a place.
    const disabled = [owner, admin, { ...member, status: 'disabled' as const }];
    expect(reasonOf(() => guard('new@example.org', { residents: 10, members: 3 })({ members: disabled, pending: [] }))).toBeUndefined();
  });
});

describe('which organization a staff request acts for', () => {
  it('needs a verified email and a membership', async () => {
    const { app, as } = setup();
    const unverified = await app.inject({ method: 'GET', url: '/api/residents', ...as('unverifiedNewcomer') });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.json().reason).toBe('email_unverified');
    const nowhere = await app.inject({ method: 'GET', url: '/api/residents', ...as('newcomer') });
    expect(nowhere.statusCode).toBe(403);
    expect(nowhere.json().reason).toBe('no_organization');
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as(null) })).statusCode).toBe(401);
  });

  it('asks which one when the account belongs to several, and refuses one it does not belong to', async () => {
    const { app, as, store } = setup();
    store.seedAccounts({ memberships: [membership('org-2', 'staff', 'member')] });
    await store.createResident(makeResident('res-1'));
    await store.createResident({ ...makeResident('res-2'), orgId: 'org-2' });

    const which = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff') });
    expect(which.statusCode).toBe(400);
    expect(which.json().reason).toBe('organization_required');
    const one = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff', 'org-1') });
    expect(one.json().residents.map((r: { id: string }) => r.id)).toEqual(['res-1']);
    const two = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff', 'org-2') });
    expect(two.json().residents.map((r: { id: string }) => r.id)).toEqual(['res-2']);

    const notMine = await app.inject({ method: 'GET', url: '/api/residents', ...as('otherStaff', 'org-2') });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json().reason).toBe('not_a_member');
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('staff', 'org/../1') })).statusCode).toBe(400);
    // Member of org-2 only: the role is the one held there.
    expect((await app.inject({ method: 'GET', url: '/api/organization/audit', ...as('staff', 'org-2') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/organization/audit', ...as('staff', 'org-1') })).statusCode).toBe(200);
  });

  it('acts for the one active organization when another membership is disabled', async () => {
    const { app, as, store } = setup();
    store.seedAccounts({ memberships: [membership('org-2', 'staff', 'member', { status: 'disabled' })] });
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('staff') })).statusCode).toBe(200);
    const disabled = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff', 'org-2') });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json().reason).toBe('membership_disabled');
  });

  it('refuses everyone in a suspended organization', async () => {
    const { app, as, store } = setup();
    await store.updateOrganization('org-1', (o) => ({ ...o, status: 'suspended' }));
    const res = await app.inject({ method: 'GET', url: '/api/queue', ...as('staff') });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe('organization_suspended');
  });

  it('lets the browser send the organization header', async () => {
    const { store } = setup();
    const { buildApp } = await import('../src/app.js');
    const { FakeVerifier, fakeSigner } = await import('./helpers.js');
    const app = buildApp({ store, verifier: new FakeVerifier(), signer: fakeSigner, corsOrigins: ['https://app.example'] });
    const res = await app.inject({ method: 'OPTIONS', url: '/api/residents', headers: { origin: 'https://app.example' } });
    expect(res.headers['access-control-allow-headers']).toMatch(/x-hachi-org/i);
    expect(res.headers['access-control-allow-methods']).toMatch(/PUT/);
  });
});

describe('one organization never sees or changes another’s data', () => {
  async function twoCompanies() {
    const s = setup();
    await s.store.createResident(makeResident('res-1'));
    await s.store.putCase(storedCase());
    await s.store.addCalls([
      call({
        id: 'call-1',
        summary: undefined,
        familySummary: undefined,
        analysis: { at: NOW.toISOString(), turns: 2, intake: { date: '2026-10-01', status: 'unknown' }, memory: { topics: [], plans: [], likes: [] }, incomplete: [{ part: 'review', failure: 'model_unavailable' }] },
      }),
    ]);
    return s;
  }

  it('answers every resident route for another organization’s resident exactly like a missing one', async () => {
    const { app, as, store } = await twoCompanies();
    const list = await app.inject({ method: 'GET', url: '/api/residents', ...as('outsider') });
    expect(list.json().residents).toEqual([]);
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/residents/res-1'],
      ['PATCH', '/api/residents/res-1', { preferredName: 'Mags' }],
      ['POST', '/api/residents/res-1/owner'],
      ['DELETE', '/api/residents/res-1/owner'],
      ['PUT', '/api/residents/res-1/owner', { uid: 'staff-9' }],
      ['POST', '/api/residents/res-1/family-access', { email: 'eve@elsewhere.org' }],
      ['DELETE', '/api/residents/res-1/family-access/alice%40example.org'],
      ['POST', '/api/residents/res-1/calls/import', { calls: [{ startedAt: '2026-09-01T01:00:00.000Z', endedAt: '2026-09-01T01:05:00.000Z', transcript: [{ speaker: 'resident', text: 'hi', startMs: 0, endMs: 1 }] }] }],
      ['GET', '/api/residents/res-1/calls/call-1'],
      ['POST', '/api/residents/res-1/calls/call-1/reanalysis'],
      ['GET', '/api/cases/case-1'],
      ['PATCH', '/api/cases/case-1', { status: 'in_progress' }],
    ];
    for (const [method, url, payload] of routes) {
      const theirs = await app.inject({ method: method as 'GET', url, ...as('outsider'), ...(payload ? { payload } : {}) });
      expect(theirs.statusCode, `${method} ${url}`).toBe(404);
    }
    const r = (await store.getResident('res-1'))!;
    expect(r.preferredName).toBe('Maggie');
    expect(r.owner?.uid).toBe('staff-1');
    expect((await store.getCase('case-1'))!.status).toBe('open');
    expect(await store.listCalls('res-1')).toHaveLength(1);
    expect(await store.listAudit('org-2', { limit: 10 })).toEqual([]);
  });

  it('keeps another organization’s residents and cases off the queue and the incomplete list', async () => {
    const { app, as } = await twoCompanies();
    const theirs = (await app.inject({ method: 'GET', url: '/api/queue?includeClosed=true', ...as('outsider') })).json();
    expect(theirs.items).toEqual([]);
    expect(theirs.summary.residents).toBe(0);
    expect(theirs.unreached.items).toEqual([]);
    expect(theirs.incomplete.items).toEqual([]);
    const mine = (await app.inject({ method: 'GET', url: '/api/queue', ...as('otherStaff') })).json();
    expect(mine.items.map((i: { caseId: string }) => i.caseId)).toEqual(['case-1']);
    expect((await app.inject({ method: 'GET', url: '/api/incomplete-analyses', ...as('outsider') })).json().items).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/incomplete-analyses', ...as('staff') })).json().items).toHaveLength(1);
  });

  it('files a new resident under the organization of whoever registers them', async () => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/residents', ...as('outsider'), payload: residentInput() });
    expect(res.statusCode).toBe(201);
    expect(res.json().orgId).toBe('org-2');
    expect((await app.inject({ method: 'GET', url: `/api/residents/${res.json().id}`, ...as('staff') })).statusCode).toBe(404);
  });
});

describe('creating an organization', () => {
  it('makes whoever creates it its owner, on the trial plan', async () => {
    const { app, as, store } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: '  Kato Home Care ', timeZone: 'Asia/Tokyo' } });
    expect(res.statusCode).toBe(201);
    const { orgId } = res.json();
    expect(orgId).not.toContain('_');
    expect(res.json()).toMatchObject({ orgName: 'Kato Home Care', role: 'owner' });
    const org = (await store.getOrganization(orgId))!;
    expect(org.billing).toEqual({ plan: 'trial', email: 'kato@example.org', limits: TRIAL_LIMITS });
    expect(org.createdBy).toBe('new-1');
    expect(await store.getMembership(orgId, 'new-1')).toMatchObject({ role: 'owner', status: 'active', email: 'kato@example.org', name: 'Kato' });
    expect((await store.listAudit(orgId, { limit: 5 })).map((e) => e.action)).toEqual(['organization.created']);
    // And they are staff now.
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('newcomer') })).statusCode).toBe(200);
  });

  it('needs a verified email, a name and a real time zone', async () => {
    const { app, as } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/organizations', ...as('unverifiedNewcomer'), payload: { name: 'X' } })).json().reason).toBe('email_unverified');
    expect((await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: 'X', timeZone: 'Mars/Base' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: 'X', plan: 'internal' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/organizations', ...as('familyPhone'), payload: { name: 'X' } })).statusCode).toBe(403);
  });

  it('limits how many organizations one account can own', async () => {
    const { app, as } = setup();
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: `Org ${i}` } })).statusCode).toBe(201);
    }
    const fourth = await app.inject({ method: 'POST', url: '/api/organizations', ...as('newcomer'), payload: { name: 'One more' } });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().reason).toBe('organization_limit');
  });
});

describe('the signed-in account', () => {
  it('lists its organizations and the invitations waiting for its verified address', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i1', { orgId: 'org-2', orgName: 'Elsewhere Care', invitedBy: { uid: 'staff-9', name: 'Kimura' } }), () => undefined);
    await store.createInvitation(pendingInvitation('old', { expiresAt: NOW.toISOString() }), () => undefined);
    await store.createInvitation(pendingInvitation('gone', { status: 'revoked' }), () => undefined);
    const me = (await app.inject({ method: 'GET', url: '/api/me', ...as('newcomer') })).json();
    expect(me).toEqual({
      uid: 'new-1',
      email: 'kato@example.org',
      emailVerified: true,
      name: 'Kato',
      phone: null,
      sms: null,
      memberships: [],
      invitations: [{ id: 'i1', orgName: 'Elsewhere Care', orgVerified: true, role: 'member', invitedBy: 'Kimura', expiresAt: pendingInvitation('i1').expiresAt }],
    });
    const staff = (await app.inject({ method: 'GET', url: '/api/me', ...as('staff') })).json();
    expect(staff.memberships).toEqual([
      { orgId: 'org-1', orgName: 'Sakura Care', timeZone: 'Asia/Tokyo', role: 'owner', status: 'active', orgStatus: 'active', verified: true },
    ]);
  });

  it('shows an unverified account no invitations, even for its address', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i1', { email: 'mori@example.org' }), () => undefined);
    const me = (await app.inject({ method: 'GET', url: '/api/me', ...as('unverifiedNewcomer') })).json();
    expect(me.emailVerified).toBe(false);
    expect(me.invitations).toEqual([]);
  });

  it('changes the display name in Firebase and on every membership', async () => {
    const { app, as, store, authAdmin } = setup();
    store.seedAccounts({ memberships: [membership('org-2', 'staff', 'member')] });
    const res = await app.inject({ method: 'PATCH', url: '/api/me', ...as('staff'), payload: { name: ' Tanaka Yui ' } });
    expect(res.json()).toEqual({ name: 'Tanaka Yui', phone: '+81300000000', sms: null });
    expect(authAdmin.names.get('staff-1')).toBe('Tanaka Yui');
    expect((await store.getMembership('org-1', 'staff-1'))?.name).toBe('Tanaka Yui');
    expect((await store.getMembership('org-2', 'staff-1'))?.name).toBe('Tanaka Yui');
    expect((await app.inject({ method: 'PATCH', url: '/api/me', ...as('staff'), payload: { name: '' } })).statusCode).toBe(400);
    // The new name is what colleagues see on the next thing they do.
    await app.inject({ method: 'POST', url: '/api/residents', ...as('staff', 'org-1'), payload: residentInput() });
    const [entry] = await store.listAudit('org-1', { limit: 1 });
    expect(entry!.actor.name).toBe('Tanaka Yui');
  });

  it('keeps the numbers alerts reach someone on, and brings the residents they are in charge of up to date', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('mine'));
    await store.createResident({ ...makeResident('legacy'), staff: { name: 'Front desk', phone: '+81355555555', email: 'desk@example.org' } });
    await store.createResident({ ...makeResident('theirs'), owner: { uid: 'staff-2', since: NOW.toISOString() }, staff: { uid: 'staff-2', name: 'Sato', phone: '+81322222222' } });
    const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/api/me', ...as('staff'), payload });
    const res = await patch({ name: 'Tanaka', phone: '03-1111-1111', sms: '090-1111-1111' });
    expect(res.json()).toEqual({ name: 'Tanaka', phone: '+81311111111', sms: '+819011111111' });
    expect((await store.getResident('mine'))!.staff).toEqual({ uid: 'staff-1', name: 'Tanaka', phone: '+81311111111', voice: '+81311111111', sms: '+819011111111', email: 'staff@example.org' });
    expect((await store.getResident('legacy'))!.staff).toMatchObject({ uid: 'staff-1', phone: '+81311111111' });
    expect((await store.getResident('theirs'))!.staff.uid).toBe('staff-2');
    // The SMS number can be taken away; the phone number only changed.
    expect((await patch({ name: 'Tanaka', sms: null })).json()).toEqual({ name: 'Tanaka', phone: '+81311111111', sms: null });
    expect((await store.getResident('mine'))!.staff.sms).toBeUndefined();
    expect((await patch({ name: 'Tanaka', phone: null })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/me', ...as('staff') })).json()).toMatchObject({ phone: '+81311111111', sms: null });
  });

  it('carries the numbers over to an organization the account joins', async () => {
    const { app, as, store } = setup();
    await invite(app, as, 'outsider', 'staff@example.org');
    const inv = (await store.listPendingInvitations('org-2'))[0]!;
    expect((await app.inject({ method: 'POST', url: `/api/invitations/${inv.id}/accept`, ...as('staff') })).statusCode).toBe(200);
    expect((await store.getMembership('org-2', 'staff-1'))!.phone).toBe('+81300000000');
  });

  it('signs out everywhere: sessions from before stop working at once, a fresh sign-in works', async () => {
    const { app, as, store, authAdmin } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/me/sign-out-everywhere', ...as('staff') })).statusCode).toBe(204);
    expect(authAdmin.revoked).toEqual(['staff-1']);
    const old = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff') });
    expect(old.statusCode).toBe(401);
    expect(old.json().reason).toBe('session_revoked');
    // Signed in again in the very second of the sign-out: Firebase's times are whole seconds.
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('staffSignedInAgain') })).statusCode).toBe(200);
    expect((await store.listAudit('org-1', { limit: 1 }))[0]).toMatchObject({ action: 'member.sessions_revoked', target: { id: 'staff-1' } });
    // Colleagues are unaffected.
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('otherStaff') })).statusCode).toBe(200);
  });

  it('does not let a session from before signing out everywhere join, create or change anything', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i9', { orgId: 'org-2', orgName: 'Elsewhere Care', email: 'staff@example.org' }), () => undefined);
    await app.inject({ method: 'POST', url: '/api/me/sign-out-everywhere', ...as('staff') });
    const refused = await Promise.all([
      app.inject({ method: 'GET', url: '/api/me', ...as('staff') }),
      app.inject({ method: 'PATCH', url: '/api/me', ...as('staff'), payload: { name: 'Thief' } }),
      app.inject({ method: 'POST', url: '/api/organizations', ...as('staff'), payload: { name: 'Thief Care' } }),
      app.inject({ method: 'POST', url: '/api/invitations/i9/accept', ...as('staff') }),
      app.inject({ method: 'POST', url: '/api/invitations/i9/decline', ...as('staff') }),
    ]);
    expect(refused.map((r) => `${r.statusCode}:${r.json().reason}`)).toEqual(Array(5).fill('401:session_revoked'));
    expect(await store.getMembership('org-2', 'staff-1')).toBeNull();
    expect((await store.getInvitation('i9'))!.status).toBe('pending');

    // Signed in again, they join; the new membership remembers the sign-out, so the old token stays out.
    expect((await app.inject({ method: 'POST', url: '/api/invitations/i9/accept', ...as('staffSignedInAgain') })).statusCode).toBe(200);
    expect((await store.getMembership('org-2', 'staff-1'))!.sessionsValidAfter).toBe(NOW.toISOString());
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('staffSignedInAgain', 'org-2') })).statusCode).toBe(200);
    const old = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff', 'org-2') });
    expect(old.json().reason).toBe('session_revoked');
    // The same holds for an organization they create.
    const created = await app.inject({ method: 'POST', url: '/api/organizations', ...as('staffSignedInAgain'), payload: { name: 'Third Care' } });
    expect((await store.getMembership(created.json().orgId, 'staff-1'))!.sessionsValidAfter).toBe(NOW.toISOString());
  });

  it('follows a revocation made in Firebase even for an account with no organization', async () => {
    const { app, as, store, authAdmin } = setup();
    await store.createInvitation(pendingInvitation('i1'), () => undefined);
    // e.g. a password change, which revokes earlier sign-ins.
    authAdmin.validAfter.set('new-1', NOW.getTime());
    expect((await app.inject({ method: 'POST', url: '/api/invitations/i1/accept', ...as('newcomer') })).json().reason).toBe('session_revoked');
    expect(await store.getMembership('org-1', 'new-1')).toBeNull();
  });
});

describe('invitations', () => {
  it('lets admins invite by address, and the invitee join by signing in with it', async () => {
    const { app, as, store } = setup();
    const res = await invite(app, as, 'admin', ' Kato@Example.org ', 'admin');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'kato@example.org', role: 'admin', expiresAt: '2026-10-15T03:00:00.000Z' });
    const listed = (await app.inject({ method: 'GET', url: '/api/organization/invitations', ...as('admin') })).json().invitations;
    expect(listed).toEqual([expect.objectContaining({ email: 'kato@example.org', invitedBy: 'Ito', expired: false })]);

    const me = (await app.inject({ method: 'GET', url: '/api/me', ...as('newcomer') })).json();
    expect(me.invitations).toEqual([expect.objectContaining({ id: res.json().id, orgName: 'Sakura Care', invitedBy: 'Ito' })]);
    const accepted = await app.inject({ method: 'POST', url: `/api/invitations/${res.json().id}/accept`, ...as('newcomer') });
    expect(accepted.json()).toEqual({ orgId: 'org-1', orgName: 'Sakura Care', role: 'admin' });
    expect(await store.getMembership('org-1', 'new-1')).toMatchObject({ role: 'admin', status: 'active', email: 'kato@example.org', name: 'Kato' });
    expect((await store.getInvitation(res.json().id))).toMatchObject({ status: 'accepted', decidedBy: 'new-1' });
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('newcomer') })).statusCode).toBe(200);
    expect((await store.listAudit('org-1', { limit: 2 })).map((e) => e.action)).toEqual(['member.joined', 'invitation.created']);

    // Used once only.
    const again = await app.inject({ method: 'POST', url: `/api/invitations/${res.json().id}/accept`, ...as('newcomer') });
    expect(again.statusCode).toBe(409);
    expect(again.json().reason).toBe('invitation_closed');
  });

  it('is for admins, never makes owners, and refuses duplicates', async () => {
    const { app, as } = setup();
    expect((await invite(app, as, 'otherStaff', 'kato@example.org')).json().reason).toBe('forbidden_role');
    expect((await invite(app, as, 'staff', 'kato@example.org', 'owner')).statusCode).toBe(400);
    expect((await invite(app, as, 'staff', 'not-an-address')).statusCode).toBe(400);
    expect((await invite(app, as, 'staff', 'kato@example.org')).statusCode).toBe(201);
    expect((await invite(app, as, 'staff', 'KATO@example.org')).json().reason).toBe('already_invited');
    expect((await invite(app, as, 'staff', 'sato@example.org')).json().reason).toBe('already_member');
    expect((await app.inject({ method: 'GET', url: '/api/organization/invitations', ...as('otherStaff') })).statusCode).toBe(403);
  });

  it('counts pending invitations against the member limit', async () => {
    const { app, as, store } = setup();
    await store.updateOrganization('org-1', (o) => ({ ...o, billing: { ...o.billing, limits: { residents: 50, members: 4 } } }));
    expect((await invite(app, as, 'staff', 'a@example.org')).statusCode).toBe(201);
    const full = await invite(app, as, 'staff', 'b@example.org');
    expect(full.statusCode).toBe(409);
    expect(full.json().reason).toBe('member_limit');
  });

  it('cannot be accepted by anyone else, and says no more about it than about one that does not exist', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i1'), () => undefined);
    const wrongPerson = await app.inject({ method: 'POST', url: '/api/invitations/i1/accept', ...as('otherStaff') });
    const missing = await app.inject({ method: 'POST', url: '/api/invitations/nope/accept', ...as('otherStaff') });
    expect(wrongPerson.statusCode).toBe(404);
    expect(wrongPerson.json()).toEqual(missing.json());
    // Holding the address is not enough until it is verified.
    store.seedAccounts({});
    const unverified = await app.inject({ method: 'POST', url: '/api/invitations/i1/accept', ...as('unverifiedNewcomer') });
    expect(unverified.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/invitations/i1/decline', ...as('otherStaff') })).statusCode).toBe(404);
    expect((await store.getInvitation('i1'))!.status).toBe('pending');
    expect(await store.getMembership('org-1', 'staff-2')).toMatchObject({ role: 'member' });
  });

  it('refuses an expired invitation', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i1', { expiresAt: NOW.toISOString() }), () => undefined);
    const res = await app.inject({ method: 'POST', url: '/api/invitations/i1/accept', ...as('newcomer') });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('invitation_expired');
    expect(await store.getMembership('org-1', 'new-1')).toBeNull();
    const listed = (await app.inject({ method: 'GET', url: '/api/organization/invitations', ...as('staff') })).json().invitations;
    expect(listed[0].expired).toBe(true);
  });

  it('can be declined by the invitee, or withdrawn by an admin of the same organization only', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i1'), () => undefined);
    await store.createInvitation(pendingInvitation('i2', { email: 'ono@example.org' }), () => undefined);
    expect((await app.inject({ method: 'POST', url: '/api/invitations/i1/decline', ...as('newcomer') })).json()).toEqual({ status: 'declined' });
    expect((await app.inject({ method: 'POST', url: '/api/invitations/i1/accept', ...as('newcomer') })).json().reason).toBe('invitation_closed');

    expect((await app.inject({ method: 'DELETE', url: '/api/organization/invitations/i2', ...as('outsider') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/invitations/i2', ...as('otherStaff') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/invitations/i2', ...as('admin') })).statusCode).toBe(204);
    expect((await store.getInvitation('i2'))).toMatchObject({ status: 'revoked', decidedBy: 'staff-3' });
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/invitations/i2', ...as('admin') })).json().reason).toBe('invitation_closed');
    expect((await store.listAudit('org-1', { limit: 5 })).map((e) => e.action)).toEqual(['invitation.revoked', 'invitation.declined']);
  });

  it('does not let a member whose access was turned off back in through a new invitation', async () => {
    const { app, as, store } = setup();
    store.seedAccounts({ memberships: [membership('org-1', 'newcomer', 'member', { status: 'disabled' })] });
    // The guard refuses to invite them at all...
    expect((await invite(app, as, 'staff', 'kato@example.org')).json().reason).toBe('already_member');
    // ...and an invitation that slipped through (made before) still cannot be used.
    await store.createInvitation(pendingInvitation('i1'), () => undefined);
    const res = await app.inject({ method: 'POST', url: '/api/invitations/i1/accept', ...as('newcomer') });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe('membership_disabled');
    expect((await store.getMembership('org-1', 'new-1'))!.status).toBe('disabled');
  });
});

describe('managing members', () => {
  it('lists the team to every member, without session details', async () => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/organization/members', ...as('otherStaff') });
    expect(res.json().members.map((m: { uid: string; role: string }) => `${m.uid}:${m.role}`)).toEqual(['staff-1:owner', 'staff-2:member', 'staff-3:admin']);
    expect(Object.keys(res.json().members[0]).sort()).toEqual(['canBeInCharge', 'email', 'joinedAt', 'name', 'role', 'status', 'uid']);
    expect(res.json().members[0].canBeInCharge).toBe(true);
  });

  it('changes roles within the rules, and records who did it', async () => {
    const { app, as, store } = setup();
    const patch = (token: string, uid: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/organization/members/${uid}`, ...as(token as never), payload });
    expect((await patch('otherStaff', 'staff-3', { role: 'member' })).json().reason).toBe('forbidden_role');
    expect((await patch('admin', 'staff-2', { role: 'admin' })).json()).toMatchObject({ uid: 'staff-2', role: 'admin' });
    expect((await patch('admin', 'staff-2', { role: 'owner' })).json().reason).toBe('owner_only');
    expect((await patch('admin', 'staff-1', { role: 'member' })).json().reason).toBe('owner_only');
    expect((await patch('staff', 'staff-1', { role: 'admin' })).json().reason).toBe('self');
    expect((await patch('staff', 'staff-9', { role: 'admin' })).statusCode).toBe(404);
    expect((await patch('staff', 'staff-2', {})).statusCode).toBe(400);
    expect((await patch('staff', 'staff-2', { role: 'superuser' })).statusCode).toBe(400);
    const [entry] = await store.listAudit('org-1', { limit: 1 });
    expect(entry).toMatchObject({ action: 'member.role_changed', actor: { uid: 'staff-3', name: 'Ito' }, target: { id: 'staff-2' }, detail: { from: 'member', to: 'admin' } });
  });

  it('hands ownership over and keeps at least one active owner', async () => {
    const { app, as } = setup();
    const patch = (token: string, uid: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/organization/members/${uid}`, ...as(token as never), payload });
    expect((await patch('staff', 'staff-3', { role: 'owner' })).json().role).toBe('owner');
    // The new owner demotes the old one: still one owner left.
    expect((await patch('admin', 'staff-1', { role: 'member' })).json().role).toBe('member');
    // The last owner cannot leave.
    const leave = await app.inject({ method: 'DELETE', url: '/api/organization/members/staff-3', ...as('admin') });
    expect(leave.statusCode).toBe(409);
    expect(leave.json().reason).toBe('last_owner');
  });

  it('turns access off and on again, at once', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1', {}));
    await store.updateResident('res-1', (r) => ({ ...r, owner: { uid: 'staff-2', since: NOW.toISOString() } }));
    expect((await app.inject({ method: 'PATCH', url: '/api/organization/members/staff-2', ...as('admin'), payload: { status: 'disabled' } })).statusCode).toBe(200);
    const off = await app.inject({ method: 'GET', url: '/api/residents', ...as('otherStaff') });
    expect(off.statusCode).toBe(403);
    expect(off.json().reason).toBe('membership_disabled');
    // Someone who will be back keeps their residents.
    expect((await store.getResident('res-1'))!.owner?.uid).toBe('staff-2');
    await app.inject({ method: 'PATCH', url: '/api/organization/members/staff-2', ...as('admin'), payload: { status: 'active' } });
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('otherStaff') })).statusCode).toBe(200);
    expect((await store.listAudit('org-1', { limit: 2 })).map((e) => e.action)).toEqual(['member.enabled', 'member.disabled']);
  });

  it('does not let turning access off and on again get round the member limit', async () => {
    const { app, as, store } = setup();
    await store.updateOrganization('org-1', (o) => ({ ...o, billing: { ...o.billing, limits: { residents: 50, members: 3 } } }));
    const status = (uid: string, s: string) => app.inject({ method: 'PATCH', url: `/api/organization/members/${uid}`, ...as('staff'), payload: { status: s } });
    expect((await status('staff-2', 'disabled')).statusCode).toBe(200);
    // The freed seat goes to someone new...
    expect((await invite(app, as, 'staff', 'kato@example.org')).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/api/invitations/${(await store.listPendingInvitations('org-1'))[0]!.id}/accept`, ...as('newcomer') })).statusCode).toBe(200);
    // ...so the old member cannot simply be turned back on.
    const back = await status('staff-2', 'active');
    expect(back.statusCode).toBe(409);
    expect(back.json().reason).toBe('member_limit');
    expect((await store.getMembership('org-1', 'staff-2'))!.status).toBe('disabled');
    expect((await store.listMembers('org-1')).filter((m) => m.status === 'active')).toHaveLength(3);
  });

  it('removes a member, unassigning their residents in this organization only', async () => {
    const { app, as, store } = setup();
    store.seedAccounts({ memberships: [membership('org-2', 'otherStaff', 'member')] });
    await store.createResident(makeResident('res-1'));
    await store.createResident({ ...makeResident('res-2'), orgId: 'org-2' });
    for (const id of ['res-1', 'res-2']) await store.updateResident(id, (r) => ({ ...r, owner: { uid: 'staff-2', since: NOW.toISOString() } }));
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/members/staff-3', ...as('otherStaff', 'org-1') })).json().reason).toBe('forbidden_role');
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/members/staff-2', ...as('admin') })).statusCode).toBe(204);
    expect(await store.getMembership('org-1', 'staff-2')).toBeNull();
    expect((await store.getResident('res-1'))!.owner).toBeUndefined();
    expect((await store.getResident('res-2'))!.owner?.uid).toBe('staff-2');
    const [entry] = await store.listAudit('org-1', { limit: 1 });
    expect(entry).toMatchObject({ action: 'member.removed', target: { id: 'staff-2', label: 'sato@example.org' }, detail: { residentsUnassigned: 1 } });
    // Only org-2 is left for them now, so it is used without asking.
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('otherStaff') })).json().residents.map((r: { id: string }) => r.id)).toEqual(['res-2']);
  });

  it('lets anyone leave', async () => {
    const { app, as, store } = setup();
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/members/staff-2', ...as('otherStaff') })).statusCode).toBe(204);
    expect((await store.listAudit('org-1', { limit: 1 }))[0]).toMatchObject({ action: 'member.left', actor: { uid: 'staff-2' } });
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('otherStaff') })).json().reason).toBe('no_organization');
  });
});

describe('admins deciding who is responsible for a resident', () => {
  it('hands a resident to an active member of the same organization', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    const put = (token: string, uid: string) => app.inject({ method: 'PUT', url: '/api/residents/res-1/owner', ...as(token as never), payload: { uid } });
    expect((await put('otherStaff', 'staff-2')).json().reason).toBe('forbidden_role');
    expect((await put('admin', 'staff-9')).json().reason).toBe('not_active_member');
    expect((await put('admin', 'a/b')).statusCode).toBe(400);
    const res = await put('admin', 'staff-2');
    expect(res.statusCode).toBe(200);
    expect(res.json().owner).toMatchObject({ uid: 'staff-2', email: 'sato@example.org', name: 'Sato' });
    expect(res.json().staff).toMatchObject({ uid: 'staff-2', name: 'Sato', phone: '+81322222222' });
    expect((await store.listAudit('org-1', { limit: 1 }))[0]).toMatchObject({
      action: 'resident.owner_changed',
      actor: { uid: 'staff-3' },
      detail: { from: 'staff-1', fromName: 'Tanaka', to: 'staff-2', toName: 'Sato' },
    });
    // The new owner can now edit and give family access; the old one, an organization owner, can still edit but not give access.
    expect((await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('otherStaff'), payload: { preferredName: 'Mags' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { preferredName: 'M' } })).statusCode).toBe(200);
    const access = (token: string) => app.inject({ method: 'POST', url: '/api/residents/res-1/family-access', ...as(token as never), payload: { email: 'bob@example.org' } });
    expect((await access('staff')).json().reason).toBe('not_owner');
    expect((await access('otherStaff')).statusCode).toBe(201);
    // Nobody whose access is off can be made responsible.
    await app.inject({ method: 'PATCH', url: '/api/organization/members/staff-2', ...as('admin'), payload: { status: 'disabled' } });
    expect((await put('staff', 'staff-1')).statusCode).toBe(200);
    expect((await put('admin', 'staff-2')).json().reason).toBe('not_active_member');
    expect((await store.getResident('res-1'))!.owner?.uid).toBe('staff-1');
  });
});

describe('plan limits', () => {
  it('stops registering residents at the plan’s limit', async () => {
    const { app, as, store } = setup();
    await store.updateOrganization('org-1', (o) => ({ ...o, billing: { ...o.billing, limits: { residents: 1, members: 10 } } }));
    expect((await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput() })).statusCode).toBe(201);
    const full = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput() });
    expect(full.statusCode).toBe(409);
    expect(full.json().reason).toBe('resident_limit');
    // Another organization's count is its own.
    expect((await app.inject({ method: 'POST', url: '/api/residents', ...as('outsider'), payload: residentInput() })).statusCode).toBe(201);
  });
});

describe('organization settings', () => {
  it('shows billing and usage to admins only', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await store.createInvitation(pendingInvitation('i1'), () => undefined);
    expect((await app.inject({ method: 'GET', url: '/api/organization', ...as('otherStaff') })).json()).toEqual({
      id: 'org-1',
      name: 'Sakura Care',
      timeZone: 'Asia/Tokyo',
      role: 'member',
      verified: true,
    });
    const admin = (await app.inject({ method: 'GET', url: '/api/organization', ...as('admin') })).json();
    expect(admin.billing).toEqual({ plan: 'internal', email: 'billing@example.org', limits: { residents: 50, members: 10 } });
    expect(admin.usage).toEqual({ residents: 1, members: 4 });
  });

  it('lets admins rename it and owners alone redirect invoices', async () => {
    const { app, as, store } = setup();
    await store.createInvitation(pendingInvitation('i1'), () => undefined);
    const patch = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/api/organization', ...as(token as never), payload });
    expect((await patch('otherStaff', { name: 'X' })).json().reason).toBe('forbidden_role');
    expect((await patch('admin', { name: 'Sakura Care East', timeZone: 'Asia/Seoul' })).json()).toMatchObject({ name: 'Sakura Care East', timeZone: 'Asia/Seoul' });
    expect((await store.getInvitation('i1'))!.orgName).toBe('Sakura Care East');
    expect((await patch('admin', { billingEmail: 'me@attacker.example' })).json().reason).toBe('forbidden_role');
    expect((await patch('staff', { billingEmail: ' Accounts@Sakura.example ' })).json().billing.email).toBe('accounts@sakura.example');
    expect((await patch('staff', {})).statusCode).toBe(400);
    expect((await patch('staff', { timeZone: 'Nowhere/City' })).statusCode).toBe(400);
    expect((await patch('staff', { billing: { plan: 'internal' } })).statusCode).toBe(400);
    expect((await store.listAudit('org-1', { limit: 2 })).map((e) => e.detail?.fields)).toEqual(['billingEmail', 'name,timeZone']);
  });
});

describe('the activity log', () => {
  it('is for admins, newest first, a page at a time', async () => {
    const { app, as } = setup();
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput({ name: `Resident ${i}` }) });
    expect((await app.inject({ method: 'GET', url: '/api/organization/audit', ...as('otherStaff') })).statusCode).toBe(403);
    const first = (await app.inject({ method: 'GET', url: '/api/organization/audit?limit=2', ...as('admin') })).json();
    expect(first.entries.map((e: { target: { label: string } }) => e.target.label)).toEqual(['Resident 2', 'Resident 1']);
    expect(first.next).toBe(first.entries[1].id);
    const rest = (await app.inject({ method: 'GET', url: `/api/organization/audit?limit=2&before=${encodeURIComponent(first.next)}`, ...as('admin') })).json();
    expect(rest.entries.map((e: { target: { label: string } }) => e.target.label)).toEqual(['Resident 0']);
    expect(rest.next).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/organization/audit?limit=1000', ...as('admin') })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/organization/audit', ...as('outsider') })).json().entries).toEqual([]);
  });

  it('records changes to residents and cases', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await store.putCase(storedCase());
    await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { preferredName: 'Mags' } });
    await app.inject({ method: 'POST', url: '/api/residents/res-1/family-access', ...as('staff'), payload: { email: 'bob@example.org' } });
    await app.inject({ method: 'DELETE', url: '/api/residents/res-1/family-access/bob%40example.org', ...as('staff') });
    await app.inject({ method: 'PATCH', url: '/api/cases/case-1', ...as('otherStaff'), payload: { urgency: 'urgent', reason: 'She sounded confused' } });
    await app.inject({ method: 'DELETE', url: '/api/residents/res-1/owner', ...as('staff') });
    await app.inject({ method: 'POST', url: '/api/residents/res-1/owner', ...as('otherStaff') });
    const entries = await store.listAudit('org-1', { limit: 10 });
    expect(entries.map((e) => e.action)).toEqual([
      'resident.owner_changed',
      'resident.owner_changed',
      'case.updated',
      'resident.family_access_revoked',
      'resident.family_access_granted',
      'resident.updated',
    ]);
    // The reason staff typed is part of the case's own history, not copied into the log.
    expect(entries[2]!.detail).toEqual({ fields: 'urgency' });
    expect(entries[5]!.detail).toEqual({ fields: 'preferredName' });
  });

  it('still saves a change when the log cannot be written', async () => {
    const { app, as, store } = setup();
    store.appendAudit = async () => {
      throw new Error('log down');
    };
    const res = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput() });
    expect(res.statusCode).toBe(201);
    expect(await store.getResident(res.json().id)).not.toBeNull();
  });
});

describe('what an organization sees of the AI budget', () => {
  it('is the same on every plan: only whether calls have stopped, never the deployment’s figures', async () => {
    const { charge, parseSpendSettings, spendMonth, USD } = await import('@hachi/core');
    const spend = parseSpendSettings({ AI_MONTHLY_CAP_USD: '10' });
    const { app, as, store } = setup({ spend });
    await store.updateOrganization('org-2', (o) => ({ ...o, billing: { ...o.billing, plan: 'trial' } }));
    expect((await store.getOrganization('org-1'))?.billing.plan).toBe('internal');
    for (const who of ['outsider', 'staff'] as const) {
      expect((await app.inject({ method: 'GET', url: '/api/spend', ...as(who) })).body).toBe('null');
    }
    await store.mutateSpendLedger(spendMonth(NOW), (l) => charge(l, 10 * USD, NOW));
    for (const who of ['outsider', 'staff'] as const) {
      const paused = (await app.inject({ method: 'GET', url: '/api/spend?locale=en', ...as(who) })).json();
      expect(paused).toEqual({ month: spendMonth(NOW), paused: true, note: 'New check-in calls have stopped for this month. Emergency contact is unaffected.' });
    }
  });
});
