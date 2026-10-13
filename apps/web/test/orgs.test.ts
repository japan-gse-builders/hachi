import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, ORG_HEADER, ORG_UNAVAILABLE_EVENT, SESSION_REVOKED_EVENT, setActiveOrg } from '../src/api';
import { actorName, atLeast, chooseOrg, describeAudit, timeZoneOptions, usableMemberships, type MembershipSummary } from '../src/orgs';

const m = (orgId: string, over: Partial<MembershipSummary> = {}): MembershipSummary => ({
  orgId,
  orgName: `Org ${orgId}`,
  timeZone: 'Asia/Tokyo',
  role: 'member',
  status: 'active',
  orgStatus: 'active',
  verified: true,
  ...over,
});

describe('which organization staff pages act for', () => {
  it('keeps the one last chosen on this device while it is still usable', () => {
    const all = [m('a'), m('b')];
    expect(chooseOrg(all, 'b')?.orgId).toBe('b');
    expect(chooseOrg(all, null)?.orgId).toBe('a');
    expect(chooseOrg(all, 'gone')?.orgId).toBe('a');
  });

  it('takes the first preference still usable: one just joined, then this tab’s, then the device’s', () => {
    const all = [m('a'), m('b'), m('c')];
    expect(chooseOrg(all, 'c', 'b', 'a')?.orgId).toBe('c');
    expect(chooseOrg(all, undefined, 'b', 'a')?.orgId).toBe('b');
    expect(chooseOrg(all, undefined, 'gone', 'c')?.orgId).toBe('c');
  });

  it('never picks one whose access is off or which is suspended', () => {
    const all = [m('a', { status: 'disabled' }), m('b', { orgStatus: 'suspended' }), m('c')];
    expect(usableMemberships(all).map((x) => x.orgId)).toEqual(['c']);
    expect(chooseOrg(all, 'a')?.orgId).toBe('c');
    expect(chooseOrg([m('a', { status: 'disabled' })], 'a')).toBeNull();
    expect(chooseOrg([], null)).toBeNull();
  });

  it('ranks roles the way the API does', () => {
    expect(atLeast('owner', 'admin')).toBe(true);
    expect(atLeast('admin', 'admin')).toBe(true);
    expect(atLeast('member', 'admin')).toBe(false);
    expect(atLeast(undefined, 'member')).toBe(false);
  });

  it('offers Tokyo first and the current zone even when the browser does not list it', () => {
    const zones = timeZoneOptions('Etc/Custom');
    expect(zones[0]).toBe('Asia/Tokyo');
    expect(zones).toContain('Etc/Custom');
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('the activity log, in words', () => {
  const entry = (action: string, detail: Record<string, string | number> = {}, label = 'Sato') => ({
    id: 'x',
    at: '2026-10-01T03:00:00.000Z',
    actor: { uid: 'u' },
    action,
    target: { type: 'member', id: 'u2', label },
    detail,
  });

  it('describes each kind of change', () => {
    expect(describeAudit(entry('member.role_changed', { from: 'member', to: 'admin' }))).toBe('Changed Sato from Member to Admin');
    expect(describeAudit(entry('member.removed', { residentsUnassigned: 2 }))).toBe('Removed Sato; 2 patient(s) now unassigned');
    expect(describeAudit(entry('member.removed', { residentsUnassigned: 0 }))).toBe('Removed Sato');
    expect(describeAudit(entry('invitation.created', { role: 'admin' }, 'kato@example.org'))).toBe('Invited kato@example.org as admin');
    expect(describeAudit(entry('organization.updated', { fields: 'name,timeZone' }))).toBe('Changed organization settings (name, timeZone)');
    expect(describeAudit(entry('resident.owner_changed', { to: 'u2', toName: 'Sato', from: 'u1', fromName: 'Ito' }, 'Maggie'))).toBe('Made Sato responsible for Maggie instead of Ito');
    expect(describeAudit(entry('resident.owner_changed', { from: 'u1', fromName: 'Ito' }, 'Maggie'))).toBe('Handed Maggie over from Ito');
    expect(describeAudit(entry('resident.family_access_granted', { email: 'bob@example.org' }, 'Maggie'))).toBe('Gave bob@example.org access to Maggie');
  });

  it('shows an action it does not know by its code rather than hiding it', () => {
    expect(describeAudit(entry('something.new'))).toBe('something.new');
  });

  it('says when the family released a message, and names people by address as well as name', () => {
    expect(describeAudit(entry('resident.contact_request_decided', { decision: 'approve', by: 'family' }, 'Maggie'))).toBe('Approved a message Maggie asked for, as their family');
    expect(actorName({ uid: 'u', name: 'Aiko Tanaka', email: 'aiko@example.org' })).toBe('Aiko Tanaka (aiko@example.org)');
    expect(actorName({ uid: 'u', email: 'aiko@example.org' })).toBe('aiko@example.org');
    expect(actorName({ uid: 'u' })).toBe('Someone');
  });

  it('says what verification changed, and that Hachi did it rather than a member', () => {
    expect(describeAudit(entry('organization.verified'))).toBe('Verified the organization: calls, alerts and family dashboards are on');
    expect(describeAudit(entry('organization.unverified'))).toBe('Withdrew the verification: calls, alerts and family dashboards are off');
    expect(actorName({ uid: 'operator', email: 'ops@hachi.example' })).toBe('Hachi support (ops@hachi.example)');
    expect(actorName({ uid: 'migration' })).toBe('Hachi (account migration)');
  });
});

describe('the API client', () => {
  afterEach(() => {
    setActiveOrg(null);
    vi.unstubAllGlobals();
  });

  const stubFetch = (status = 200, body: unknown = {}) => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const headersOf = (fetch: ReturnType<typeof stubFetch>) => new Headers(fetch.mock.calls[0]![1].headers);

  it('sends the organization on staff requests and never on family ones', async () => {
    const fetch = stubFetch();
    setActiveOrg('org-1');
    await api('/api/residents', 't');
    expect(headersOf(fetch).get(ORG_HEADER)).toBe('org-1');
    fetch.mockClear();
    await api('/api/family/residents', 't');
    expect(headersOf(fetch).has(ORG_HEADER)).toBe(false);
  });

  it('lets a caller name another organization, as leaving one does', async () => {
    const fetch = stubFetch();
    setActiveOrg('org-1');
    await api('/api/organization/members/u', 't', { method: 'DELETE', headers: { [ORG_HEADER]: 'org-2' } });
    expect(headersOf(fetch).get(ORG_HEADER)).toBe('org-2');
  });

  it('tells the app when this device was signed out everywhere, and keeps the reason', async () => {
    stubFetch(401, { error: 'You were signed out', reason: 'session_revoked' });
    const heard = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal('window', Object.assign(target, { dispatchEvent: target.dispatchEvent.bind(target) }));
    target.addEventListener(SESSION_REVOKED_EVENT, heard);
    const err = await api('/api/residents', 't').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).reason).toBe('session_revoked');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('tells the app when the organization it acts for can no longer be used, but not for one named explicitly', async () => {
    const heard = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal('window', Object.assign(target, { dispatchEvent: target.dispatchEvent.bind(target) }));
    target.addEventListener(ORG_UNAVAILABLE_EVENT, heard);
    setActiveOrg('org-1');
    for (const reason of ['not_a_member', 'membership_disabled', 'organization_suspended']) {
      stubFetch(403, { reason });
      await api('/api/residents', 't').catch(() => undefined);
    }
    expect(heard).toHaveBeenCalledTimes(3);
    stubFetch(403, { reason: 'forbidden_role' });
    await api('/api/organization/audit', 't').catch(() => undefined);
    stubFetch(403, { reason: 'not_a_member' });
    await api('/api/organization/members/u', 't', { method: 'DELETE', headers: { [ORG_HEADER]: 'org-2' } }).catch(() => undefined);
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
