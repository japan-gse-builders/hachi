import { describe, expect, it } from 'vitest';
import { MemoryStore, NotFoundError, type CaseEvent, type OutboxEntry, type Store } from '@hachi/store';
import { call, makeResident, storedCase } from './helpers.js';

/**
 * The same behavioural contract for every Store implementation. The Firestore variant runs
 * only when FIRESTORE_EMULATOR_HOST is set (`npm run test:emulator`).
 */
function contract(name: string, make: () => Promise<Store>) {
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
      expect((await s.listResidents()).map((r) => r.id)).toEqual(['r-a', 'r-b']);
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
      expect((await s.listOpenCases()).map((c) => c.id).sort()).toEqual(['a', 'b', 'd']);
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
      const base: OutboxEntry = {
        id: 'held',
        idempotencyKey: 'contact:call-1',
        caseId: 'call-1',
        kind: 'contact_request',
        residentId: 'res-1',
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
      await s.enqueueOutbox([base, { ...base, id: 'queued', idempotencyKey: 'k2', status: 'pending' }]);
      expect((await s.listPendingOutbox(10)).map((e) => e.id)).toEqual(['queued']);
      expect((await s.listOutboxAwaitingApproval(10)).map((e) => e.id)).toEqual(['held']);
    });

    it('returns copies, so callers cannot mutate stored state', async () => {
      const s = await make();
      await s.createResident(makeResident('r-1'));
      const r = (await s.getResident('r-1'))!;
      r.name = 'changed';
      expect((await s.getResident('r-1'))?.name).toBe('Margaret Smith');
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
