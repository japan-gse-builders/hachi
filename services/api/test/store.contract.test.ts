import { describe, expect, it } from 'vitest';
import {
  auditId,
  MemoryStore,
  NotFoundError,
  type AccountStore,
  type AuditEntry,
  type CaseEvent,
  type Invitation,
  type OutboxEntry,
  type Store,
} from '@hachi/store';
import { call, makeResident, membership, organization, storedCase } from './helpers.js';

function heldEntry(id: string, orgId: string): OutboxEntry {
  return {
    id,
    idempotencyKey: `contact:${id}`,
    caseId: `call-${id}`,
    kind: 'contact_request',
    residentId: orgId === 'org-1' ? 'res-1' : 'r-2',
    orgId,
    urgency: 'watch',
    recipient: 'contact',
    channel: 'sms',
    address: '+819011112222',
    subject: 's',
    body: 'b',
    priority: 'normal',
    status: 'awaiting_approval',
    attempts: 0,
    createdAt: '2026-10-01T03:00:00.000Z',
  };
}

function invitation(id: string, overrides: Partial<Invitation> = {}): Invitation {
  return {
    id,
    orgId: 'org-1',
    orgName: 'Sakura Care',
    email: 'kato@example.org',
    role: 'member',
    status: 'pending',
    invitedBy: { uid: 'staff-1' },
    createdAt: '2026-10-01T00:00:00.000Z',
    expiresAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

function auditAt(at: string, unique: string, orgId = 'org-1'): AuditEntry {
  return { id: auditId(at, unique), orgId, at, actor: { uid: 'staff-1' }, action: 'resident.updated' };
}

/**
 * The same behavioural contract for every Store implementation. The Firestore variant runs
 * only when FIRESTORE_EMULATOR_HOST is set (`npm run test:emulator`).
 */
function contract(name: string, make: () => Promise<Store & AccountStore>) {
  describe(`Store contract: ${name}`, () => {
    it('creates, reads, updates and lists residents', async () => {
      const s = await make();
      await s.createResident(makeResident('r-b', { name: 'Bob Brown' }));
      await s.createResident(makeResident('r-a', { name: 'Ann Adams' }));
      expect((await s.getResident('r-a'))?.name).toBe('Ann Adams');
      expect(await s.getResident('missing')).toBeNull();
      const updated = await s.updateResident('r-a', (r) => ({ ...r, preferredName: 'Annie' }));
      expect(updated.preferredName).toBe('Annie');
      expect((await s.getResident('r-a'))?.preferredName).toBe('Annie');
      expect((await s.listResidents('org-1')).map((r) => r.id)).toEqual(['r-a', 'r-b']);
    });

    it('lists residents, open cases and held messages of one organization only', async () => {
      const s = await make();
      await s.createResident(makeResident('r-1'));
      await s.createResident({ ...makeResident('r-2'), orgId: 'org-2' });
      expect((await s.listResidents('org-1')).map((r) => r.id)).toEqual(['r-1']);
      expect((await s.listResidents('org-2')).map((r) => r.id)).toEqual(['r-2']);
      expect(await s.listResidents('org-3')).toEqual([]);
      // Workers still see everyone: calls are placed for every organization.
      expect((await s.listActiveResidents()).map((r) => r.id).sort()).toEqual(['r-1', 'r-2']);

      await s.putCase(storedCase({ id: 'a' }));
      await s.putCase(storedCase({ id: 'b', orgId: 'org-2', residentId: 'r-2' }));
      expect((await s.listOpenCases('org-1')).map((c) => c.id)).toEqual(['a']);
      expect((await s.listOpenCases('org-2')).map((c) => c.id)).toEqual(['b']);

      await s.enqueueOutbox([heldEntry('h1', 'org-1'), heldEntry('h2', 'org-2')]);
      expect((await s.listOutboxAwaitingApproval('org-1', 10)).map((e) => e.id)).toEqual(['h1']);
      expect((await s.listOutboxAwaitingApproval('org-2', 10)).map((e) => e.id)).toEqual(['h2']);
    });

    it('rejects duplicate resident ids and updates of missing residents', async () => {
      const s = await make();
      await s.createResident(makeResident('r-1'));
      await expect(s.createResident(makeResident('r-1'))).rejects.toThrow();
      await expect(s.updateResident('missing', (r) => r)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('finds residents by normalized family contact', async () => {
      const s = await make();
      await s.createResident(makeResident('r-1'));
      await s.createResident(makeResident('r-2', { family: undefined }));
      expect((await s.findResidentsByFamilyContact('+819000000002')).map((r) => r.id)).toEqual(['r-1']);
      expect((await s.findResidentsByFamilyContact('alice@example.org')).map((r) => r.id)).toEqual(['r-1']);
      expect(await s.findResidentsByFamilyContact('+819099999999')).toEqual([]);
    });

    it('stores calls and lists them newest first with since/limit', async () => {
      const s = await make();
      await s.createResident(makeResident('res-1'));
      await s.addCalls([
        call({ id: 'c1', startedAt: '2026-09-01T01:00:00.000Z' }),
        call({ id: 'c3', startedAt: '2026-09-03T01:00:00.000Z' }),
        call({ id: 'c2', startedAt: '2026-09-02T01:00:00.000Z' }),
        call({ id: 'other', residentId: 'res-2' }),
      ]);
      expect((await s.listCalls('res-1')).map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
      expect((await s.listCalls('res-1', { since: '2026-09-02T00:00:00.000Z' })).map((c) => c.id)).toEqual(['c3', 'c2']);
      expect((await s.listCalls('res-1', { limit: 1 })).map((c) => c.id)).toEqual(['c3']);
    });

    it('stores cases and lists open ones and by resident', async () => {
      const s = await make();
      await s.putCase(storedCase({ id: 'a' }));
      await s.putCase(storedCase({ id: 'b', status: 'in_progress' }));
      await s.putCase(storedCase({ id: 'c', status: 'closed' }));
      await s.putCase(storedCase({ id: 'd', residentId: 'res-2' }));
      expect((await s.listOpenCases('org-1')).map((c) => c.id).sort()).toEqual(['a', 'b', 'd']);
      expect((await s.listCasesByResident('res-1')).map((c) => c.id).sort()).toEqual(['a', 'b', 'c']);
      expect((await s.getCase('a'))?.id).toBe('a');
      expect(await s.getCase('zzz')).toBeNull();
    });

    it('mutates a case and records events atomically', async () => {
      const s = await make();
      await s.putCase(storedCase({ id: 'a' }));
      const ev = (id: string, at: string): CaseEvent => ({
        id,
        caseId: 'a',
        at,
        actorUid: 'staff-1',
        type: 'status_changed',
        from: 'open',
        to: 'in_progress',
        autoUrgency: 'watch',
      });
      const next = await s.mutateCase('a', (c) => ({
        case: { ...c, status: 'in_progress' },
        events: [ev('e2', '2026-10-01T02:00:00.000Z'), ev('e1', '2026-10-01T01:00:00.000Z')],
      }));
      expect(next.status).toBe('in_progress');
      expect((await s.getCase('a'))?.status).toBe('in_progress');
      expect((await s.listCaseEvents('a')).map((e) => e.id)).toEqual(['e1', 'e2']);
      await expect(s.mutateCase('missing', (c) => ({ case: c, events: [] }))).rejects.toBeInstanceOf(NotFoundError);
    });

    it('lists only active residents', async () => {
      const s = await make();
      await s.createResident(makeResident('r-1'));
      await s.createResident({ ...makeResident('r-2'), active: false });
      expect((await s.listActiveResidents()).map((r) => r.id)).toEqual(['r-1']);
    });

    it('creates a call only once and updates it atomically', async () => {
      const s = await make();
      expect(await s.createCallIfAbsent(call({ id: 'c1', status: 'scheduled' }))).toBe(true);
      expect(await s.createCallIfAbsent(call({ id: 'c1', status: 'failed' }))).toBe(false);
      expect((await s.getCall('res-1', 'c1'))?.status).toBe('scheduled');
      expect(await s.getCall('res-1', 'missing')).toBeNull();

      const updated = await s.updateCall('res-1', 'c1', (c) => ({ ...c, status: 'in_progress' }));
      expect(updated.status).toBe('in_progress');
      const unchanged = await s.updateCall('res-1', 'c1', () => null);
      expect(unchanged.status).toBe('in_progress');
      expect((await s.getCall('res-1', 'c1'))?.status).toBe('in_progress');
      await expect(s.updateCall('res-1', 'missing', (c) => c)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('creates outbox entries once per id', async () => {
      const s = await make();
      const entry = (id: string, caseId = 'case-1'): OutboxEntry => ({
        id,
        idempotencyKey: `k-${id}`,
        caseId,
        residentId: 'res-1',
        orgId: 'org-1',
        urgency: 'emergency',
        recipient: 'family',
        channel: 'sms',
        address: '+819000000002',
        subject: 's',
        body: 'b',
        priority: 'immediate',
        status: 'pending',
        attempts: 0,
        createdAt: '2026-10-01T03:00:00.000Z',
      });
      expect((await s.enqueueOutbox([entry('a'), entry('b')])).map((e) => e.id)).toEqual(['a', 'b']);
      expect((await s.enqueueOutbox([entry('a'), entry('c', 'case-2')])).map((e) => e.id)).toEqual(['c']);
      expect((await s.listOutboxByCase('case-1')).map((e) => e.id).sort()).toEqual(['a', 'b']);

      expect((await s.getOutbox('a'))?.status).toBe('pending');
      expect(await s.getOutbox('missing')).toBeNull();
      const sent = await s.updateOutbox('a', (e) => ({ ...e, status: 'sent', sentAt: '2026-10-01T03:00:05.000Z' }));
      expect(sent.status).toBe('sent');
      expect((await s.updateOutbox('a', () => null)).status).toBe('sent');
      await expect(s.updateOutbox('missing', (e) => e)).rejects.toBeInstanceOf(NotFoundError);
      expect((await s.listPendingOutbox(10)).map((e) => e.id).sort()).toEqual(['b', 'c']);
      expect(await s.listPendingOutbox(1)).toHaveLength(1);
    });

    it('keeps entries held for approval out of the queue the delivery worker reads', async () => {
      const s = await make();
      const base = heldEntry('held', 'org-1');
      await s.enqueueOutbox([base, { ...base, id: 'queued', idempotencyKey: 'k2', status: 'pending' }]);
      expect((await s.listPendingOutbox(10)).map((e) => e.id)).toEqual(['queued']);
      expect((await s.listOutboxAwaitingApproval('org-1', 10)).map((e) => e.id)).toEqual(['held']);
    });

    it('returns copies, so callers cannot mutate stored state', async () => {
      const s = await make();
      await s.createResident(makeResident('r-1'));
      const r = (await s.getResident('r-1'))!;
      r.name = 'changed';
      expect((await s.getResident('r-1'))?.name).toBe('Margaret Smith');
    });

    it('starts a spend month empty and writes nothing when a reservation is refused', async () => {
      const s = await make();
      expect(await s.getSpendLedger('2026-10')).toBeNull();
      const taken = await s.mutateSpendLedger('2026-10', (l) => ({ ...l, spentMicros: l.spentMicros + 500 }));
      expect(taken).toMatchObject({ month: '2026-10', spentMicros: 500 });
      // A refusal has to leave no trace, or a refused call would still move the month.
      expect(await s.mutateSpendLedger('2026-10', () => null)).toBeNull();
      expect((await s.getSpendLedger('2026-10'))?.spentMicros).toBe(500);
      expect(await s.getSpendLedger('2026-11')).toBeNull();
    });

    it('starts with nothing known about the gateway and writes nothing when a call is refused', async () => {
      const s = await make();
      // Nothing known has to mean "dial", or an empty database would stop the whole service.
      expect(await s.getGatewayBreaker()).toBeNull();
      const tripped = await s.mutateGatewayBreaker((b) => ({ ...b, failures: b.failures + 1, fault: 'systemic' }));
      expect(tripped).toMatchObject({ failures: 1, fault: 'systemic' });
      expect(await s.mutateGatewayBreaker(() => null)).toBeNull();
      expect(await s.getGatewayBreaker()).toMatchObject({ failures: 1 });
    });

    // ---- Accounts ----

    it('creates an organization together with its owner, and refuses a second with the same id', async () => {
      const s = await make();
      await s.createOrganization(organization('org-1'), membership('org-1', 'staff', 'owner'));
      expect((await s.getOrganization('org-1'))?.name).toBe('Sakura Care');
      expect(await s.getOrganization('nope')).toBeNull();
      expect(await s.getMembership('org-1', 'staff-1')).toMatchObject({ role: 'owner', status: 'active' });
      await expect(s.createOrganization(organization('org-1'), membership('org-1', 'outsider', 'owner'))).rejects.toThrow();
      expect(await s.getMembership('org-1', 'staff-9')).toBeNull();
      const renamed = await s.updateOrganization('org-1', (o) => ({ ...o, name: 'Sakura Care West' }));
      expect(renamed.name).toBe('Sakura Care West');
      await expect(s.updateOrganization('nope', (o) => o)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('lists members by organization and by person, in joining order', async () => {
      const s = await make();
      await s.createOrganization(organization('org-1'), membership('org-1', 'staff', 'owner'));
      await s.createOrganization(organization('org-2'), membership('org-2', 'outsider', 'owner'));
      await s.createInvitation(invitation('i1', { email: 'sato@example.org' }), () => undefined);
      await s.acceptInvitation('i1', 'staff-2', (inv) => ({
        invitation: { ...inv, status: 'accepted' },
        membership: membership('org-1', 'otherStaff', 'member', { joinedAt: '2026-10-01T00:00:00.000Z' }),
      }));
      await s.createInvitation(invitation('i2', { orgId: 'org-2', email: 'sato@example.org' }), () => undefined);
      await s.acceptInvitation('i2', 'staff-2', (inv) => ({
        invitation: { ...inv, status: 'accepted' },
        membership: membership('org-2', 'otherStaff', 'admin', { joinedAt: '2026-10-02T00:00:00.000Z' }),
      }));
      expect((await s.listMembers('org-1')).map((m) => m.uid)).toEqual(['staff-1', 'staff-2']);
      expect((await s.listMembershipsByUser('staff-2')).map((m) => `${m.orgId}:${m.role}`)).toEqual(['org-1:member', 'org-2:admin']);
      expect((await s.getInvitation('i1'))?.status).toBe('accepted');
    });

    it('changes or removes a membership against the roster as stored, and aborts when fn throws', async () => {
      const s = await make();
      await s.createOrganization(organization('org-1'), membership('org-1', 'staff', 'owner'));
      await s.createInvitation(invitation('i1'), () => undefined);
      await s.createInvitation(invitation('i2', { orgId: 'org-2' }), () => undefined);
      let seen: string[] = [];
      const next = await s.mutateMembership('org-1', 'staff-1', (m, roster) => {
        seen = [...roster.members.map((x) => x.uid), ...roster.pending.map((i) => i.id)];
        return { ...m, name: 'Owner' };
      });
      expect(seen).toEqual(['staff-1', 'i1']);
      expect(next?.name).toBe('Owner');
      await expect(s.mutateMembership('org-1', 'staff-1', () => { throw new Error('refused'); })).rejects.toThrow('refused');
      expect((await s.getMembership('org-1', 'staff-1'))?.name).toBe('Owner');
      expect(await s.mutateMembership('org-1', 'staff-1', () => null)).toBeNull();
      expect(await s.getMembership('org-1', 'staff-1')).toBeNull();
      await expect(s.mutateMembership('org-1', 'staff-1', (m) => m)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('updates every membership of one person at once', async () => {
      const s = await make();
      await s.createOrganization(organization('org-1'), membership('org-1', 'staff', 'owner'));
      await s.createOrganization(organization('org-2'), membership('org-2', 'staff', 'owner'));
      await s.createOrganization(organization('org-3'), membership('org-3', 'outsider', 'owner'));
      const updated = await s.updateMembershipsOfUser('staff-1', (m) => ({ ...m, sessionsValidAfter: '2026-10-01T03:00:00.000Z' }));
      expect(updated.map((m) => m.orgId).sort()).toEqual(['org-1', 'org-2']);
      expect((await s.getMembership('org-2', 'staff-1'))?.sessionsValidAfter).toBe('2026-10-01T03:00:00.000Z');
      expect((await s.getMembership('org-3', 'staff-9'))?.sessionsValidAfter).toBeUndefined();
      expect(await s.updateMembershipsOfUser('nobody', (m) => m)).toEqual([]);
    });

    it('creates invitations through a guard that sees members and pending invitations', async () => {
      const s = await make();
      await s.createOrganization(organization('org-1'), membership('org-1', 'staff', 'owner'));
      await s.createInvitation(invitation('i1'), () => undefined);
      let ctx: { members: string[]; pending: string[] } | undefined;
      await expect(
        s.createInvitation(invitation('i2', { email: 'other@example.org' }), (c) => {
          ctx = { members: c.members.map((m) => m.uid), pending: c.pending.map((i) => i.id) };
          throw new Error('full');
        }),
      ).rejects.toThrow('full');
      expect(ctx).toEqual({ members: ['staff-1'], pending: ['i1'] });
      expect(await s.getInvitation('i2')).toBeNull();
      await expect(s.createInvitation(invitation('i1'), () => undefined)).rejects.toThrow();

      expect((await s.listPendingInvitations('org-1')).map((i) => i.id)).toEqual(['i1']);
      expect((await s.listPendingInvitationsByEmail('kato@example.org')).map((i) => i.id)).toEqual(['i1']);
      await s.updateInvitation('i1', (i) => ({ ...i, status: 'revoked' }));
      expect(await s.listPendingInvitations('org-1')).toEqual([]);
      expect(await s.listPendingInvitationsByEmail('kato@example.org')).toEqual([]);
      await expect(s.updateInvitation('nope', (i) => i)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('accepts an invitation by writing it and the membership together, or neither', async () => {
      const s = await make();
      await s.createOrganization(organization('org-1'), membership('org-1', 'staff', 'owner'));
      await s.createInvitation(invitation('i1'), () => undefined);
      await expect(s.acceptInvitation('i1', 'new-1', () => { throw new Error('expired'); })).rejects.toThrow('expired');
      expect((await s.getInvitation('i1'))?.status).toBe('pending');
      expect(await s.getMembership('org-1', 'new-1')).toBeNull();
      // An invitation cannot be turned into membership of another organization, or for another person.
      await expect(
        s.acceptInvitation('i1', 'new-1', (inv) => ({ invitation: { ...inv, status: 'accepted' }, membership: membership('org-2', 'newcomer', 'member') })),
      ).rejects.toThrow();
      await expect(
        s.acceptInvitation('i1', 'new-1', (inv) => ({ invitation: { ...inv, status: 'accepted' }, membership: membership('org-1', 'otherStaff', 'member') })),
      ).rejects.toThrow();
      expect(await s.getMembership('org-1', 'staff-2')).toBeNull();
      const m = await s.acceptInvitation('i1', 'new-1', (inv, existing, members) => {
        expect(existing).toBeNull();
        expect(members.map((x) => x.uid)).toEqual(['staff-1']);
        return { invitation: { ...inv, status: 'accepted' }, membership: membership('org-1', 'newcomer', 'member') };
      });
      expect(m.uid).toBe('new-1');
      expect((await s.getInvitation('i1'))?.status).toBe('accepted');
      expect(await s.getMembership('org-1', 'new-1')).toMatchObject({ role: 'member' });
      await expect(s.acceptInvitation('nope', 'new-1', (inv) => ({ invitation: inv, membership: m }))).rejects.toBeInstanceOf(NotFoundError);
    });

    it('pages the audit log newest first without skipping entries made in the same millisecond', async () => {
      const s = await make();
      const at = '2026-10-01T03:00:00.000Z';
      await s.appendAudit(auditAt('2026-10-01T01:00:00.000Z', 'a'));
      await s.appendAudit(auditAt(at, 'b'));
      await s.appendAudit(auditAt(at, 'c'));
      await s.appendAudit(auditAt(at, 'd', 'org-2'));
      const first = await s.listAudit('org-1', { limit: 2 });
      expect(first.map((e) => e.id)).toEqual([auditId(at, 'c'), auditId(at, 'b')]);
      const rest = await s.listAudit('org-1', { limit: 2, before: first[1]!.id });
      expect(rest.map((e) => e.id)).toEqual([auditId('2026-10-01T01:00:00.000Z', 'a')]);
      expect((await s.listAudit('org-2', { limit: 10 })).map((e) => e.orgId)).toEqual(['org-2']);
    });
  });
}

contract('memory', async () => new MemoryStore());

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!emulator)('Firestore emulator', () => {
  contract('firestore', async () => {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { FirestoreStore } = await import('@hachi/store');
    const app = getApps()[0] ?? initializeApp({ projectId: 'demo-hachi' });
    const db = getFirestore(app);
    if (!(db as unknown as { _settingsFrozen?: boolean })._settingsFrozen) {
      try {
        db.settings({ ignoreUndefinedProperties: true });
      } catch {
        // already initialized
      }
    }
    await fetch(`http://${emulator}/emulator/v1/projects/demo-hachi/databases/(default)/documents`, { method: 'DELETE' });
    return new FirestoreStore(db);
  });
});
