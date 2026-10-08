import { emptyLedger, type SpendLedger } from '@hachi/core';
import type { Firestore } from 'firebase-admin/firestore';
import type { CallRecord, CaseEvent, OutboxEntry, OutboxStatus, Resident, StoredCase } from './model.js';
import { NotFoundError, type CaseMutation, type ListCallsOptions, type Store } from './types.js';

const BATCH_LIMIT = 400;
/** gRPC status code returned by `create()` when the document exists. */
const ALREADY_EXISTS = 6;

/**
 * Layout:
 *   residents/{id}
 *   residents/{id}/calls/{callId}
 *   cases/{id}
 *   cases/{id}/events/{eventId}
 *   outbox/{sha256(idempotencyKey)}
 *   spend/{YYYY-MM}
 * The Firestore instance must be created with `ignoreUndefinedProperties: true`.
 */
export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  private residentsCol() {
    return this.db.collection('residents');
  }

  private callsCol(residentId: string) {
    return this.residentsCol().doc(residentId).collection('calls');
  }

  private casesCol() {
    return this.db.collection('cases');
  }

  async createResident(r: Resident): Promise<void> {
    await this.residentsCol().doc(r.id).create(r);
  }

  async getResident(id: string): Promise<Resident | null> {
    const snap = await this.residentsCol().doc(id).get();
    return snap.exists ? (snap.data() as Resident) : null;
  }

  async updateResident(id: string, fn: (r: Resident) => Resident): Promise<Resident> {
    const ref = this.residentsCol().doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError('Resident');
      const next = fn(snap.data() as Resident);
      tx.set(ref, next);
      return next;
    });
  }

  async listResidents(): Promise<Resident[]> {
    const snap = await this.residentsCol().orderBy('name').get();
    return snap.docs.map((d) => d.data() as Resident);
  }

  async listActiveResidents(): Promise<Resident[]> {
    const snap = await this.residentsCol().where('active', '==', true).get();
    return snap.docs.map((d) => d.data() as Resident);
  }

  async createCallIfAbsent(call: CallRecord): Promise<boolean> {
    try {
      await this.callsCol(call.residentId).doc(call.id).create(call);
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return false;
      throw err;
    }
  }

  async getCall(residentId: string, callId: string): Promise<CallRecord | null> {
    const snap = await this.callsCol(residentId).doc(callId).get();
    return snap.exists ? (snap.data() as CallRecord) : null;
  }

  async updateCall(residentId: string, callId: string, fn: (c: CallRecord) => CallRecord | null): Promise<CallRecord> {
    const ref = this.callsCol(residentId).doc(callId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError('Call');
      const current = snap.data() as CallRecord;
      const next = fn(current);
      if (!next) return current;
      tx.set(ref, next);
      return next;
    });
  }

  async findResidentsByFamilyContact(contact: string): Promise<Resident[]> {
    const snap = await this.residentsCol().where('familyLookup', 'array-contains', contact).get();
    return snap.docs.map((d) => d.data() as Resident);
  }

  async addCalls(calls: CallRecord[]): Promise<void> {
    for (let i = 0; i < calls.length; i += BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const c of calls.slice(i, i + BATCH_LIMIT)) batch.set(this.callsCol(c.residentId).doc(c.id), c);
      await batch.commit();
    }
  }

  async listCalls(residentId: string, opts: ListCallsOptions = {}): Promise<CallRecord[]> {
    let q = this.callsCol(residentId).orderBy('startedAt', 'desc');
    if (opts.since) q = q.where('startedAt', '>=', opts.since);
    if (opts.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as CallRecord);
  }

  async getCase(id: string): Promise<StoredCase | null> {
    const snap = await this.casesCol().doc(id).get();
    return snap.exists ? (snap.data() as StoredCase) : null;
  }

  async putCase(c: StoredCase): Promise<void> {
    await this.casesCol().doc(c.id).set(c);
  }

  async listOpenCases(): Promise<StoredCase[]> {
    const snap = await this.casesCol().where('status', 'in', ['open', 'in_progress']).get();
    return snap.docs.map((d) => d.data() as StoredCase);
  }

  async listCasesByResident(residentId: string): Promise<StoredCase[]> {
    const snap = await this.casesCol().where('residentId', '==', residentId).get();
    return snap.docs.map((d) => d.data() as StoredCase);
  }

  async mutateCase(id: string, fn: (c: StoredCase) => CaseMutation): Promise<StoredCase> {
    const ref = this.casesCol().doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError('Case');
      const { case: next, events } = fn(snap.data() as StoredCase);
      tx.set(ref, next);
      for (const e of events) tx.set(ref.collection('events').doc(e.id), e);
      return next;
    });
  }

  async listCaseEvents(caseId: string): Promise<CaseEvent[]> {
    const snap = await this.casesCol().doc(caseId).collection('events').orderBy('at').get();
    return snap.docs.map((d) => d.data() as CaseEvent);
  }

  async enqueueOutbox(entries: OutboxEntry[]): Promise<OutboxEntry[]> {
    const results = await Promise.all(
      entries.map(async (e) => {
        try {
          await this.db.collection('outbox').doc(e.id).create(e);
          return e;
        } catch (err) {
          if ((err as { code?: number }).code === ALREADY_EXISTS) return null;
          throw err;
        }
      }),
    );
    return results.filter((e): e is OutboxEntry => e !== null);
  }

  async listOutboxByCase(caseId: string): Promise<OutboxEntry[]> {
    const snap = await this.db.collection('outbox').where('caseId', '==', caseId).get();
    return snap.docs.map((d) => d.data() as OutboxEntry);
  }

  async getOutbox(id: string): Promise<OutboxEntry | null> {
    const snap = await this.db.collection('outbox').doc(id).get();
    return snap.exists ? (snap.data() as OutboxEntry) : null;
  }

  async updateOutbox(id: string, fn: (e: OutboxEntry) => OutboxEntry | null): Promise<OutboxEntry> {
    const ref = this.db.collection('outbox').doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError('Outbox entry');
      const current = snap.data() as OutboxEntry;
      const next = fn(current);
      if (!next) return current;
      tx.set(ref, next);
      return next;
    });
  }

  // Single-field filter only, so no composite index is needed.
  async listPendingOutbox(limit: number): Promise<OutboxEntry[]> {
    return this.outboxByStatus('pending', limit);
  }

  async listOutboxAwaitingApproval(limit: number): Promise<OutboxEntry[]> {
    return this.outboxByStatus('awaiting_approval', limit);
  }

  private async outboxByStatus(status: OutboxStatus, limit: number): Promise<OutboxEntry[]> {
    const snap = await this.db.collection('outbox').where('status', '==', status).limit(limit).get();
    return snap.docs.map((d) => d.data() as OutboxEntry);
  }

  async getSpendLedger(month: string): Promise<SpendLedger | null> {
    const snap = await this.db.collection('spend').doc(month).get();
    return snap.exists ? (snap.data() as SpendLedger) : null;
  }

  /**
   * One document per month, so the read that decides whether a call may be placed and the write
   * that reserves its cost are the same transaction. Two workers dialing at once therefore cannot
   * both see room for the last call.
   */
  async mutateSpendLedger(month: string, fn: (l: SpendLedger) => SpendLedger | null): Promise<SpendLedger | null> {
    const ref = this.db.collection('spend').doc(month);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data() as SpendLedger) : emptyLedger(month, new Date(0).toISOString());
      const next = fn(current);
      if (!next) return null;
      tx.set(ref, next);
      return next;
    });
  }
}
