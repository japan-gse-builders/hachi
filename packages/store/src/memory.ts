import { emptyLedger, type SpendLedger } from '@hachi/core';
import type { CallRecord, CaseEvent, OutboxEntry, OutboxStatus, Resident, StoredCase } from './model.js';
import { NotFoundError, type CaseMutation, type ListCallsOptions, type Store } from './types.js';

const clone = <T>(v: T): T => structuredClone(v);

/** Store used in tests and local development; same semantics as the Firestore store. */
export class MemoryStore implements Store {
  private residents = new Map<string, Resident>();
  private calls = new Map<string, CallRecord>();
  private cases = new Map<string, StoredCase>();
  private events = new Map<string, CaseEvent>();
  private outbox = new Map<string, OutboxEntry>();
  private ledgers = new Map<string, SpendLedger>();

  async createResident(r: Resident): Promise<void> {
    if (this.residents.has(r.id)) throw new Error(`Resident ${r.id} already exists`);
    this.residents.set(r.id, clone(r));
  }

  async getResident(id: string): Promise<Resident | null> {
    const r = this.residents.get(id);
    return r ? clone(r) : null;
  }

  async updateResident(id: string, fn: (r: Resident) => Resident): Promise<Resident> {
    const r = this.residents.get(id);
    if (!r) throw new NotFoundError('Resident');
    const next = fn(clone(r));
    this.residents.set(id, clone(next));
    return clone(next);
  }

  async listResidents(): Promise<Resident[]> {
    return [...this.residents.values()].map(clone).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listActiveResidents(): Promise<Resident[]> {
    return (await this.listResidents()).filter((r) => r.active);
  }

  async findResidentsByFamilyContact(contact: string): Promise<Resident[]> {
    return [...this.residents.values()].filter((r) => r.familyLookup.includes(contact)).map(clone);
  }

  async addCalls(calls: CallRecord[]): Promise<void> {
    for (const c of calls) this.calls.set(`${c.residentId}/${c.id}`, clone(c));
  }

  async createCallIfAbsent(call: CallRecord): Promise<boolean> {
    const key = `${call.residentId}/${call.id}`;
    if (this.calls.has(key)) return false;
    this.calls.set(key, clone(call));
    return true;
  }

  async getCall(residentId: string, callId: string): Promise<CallRecord | null> {
    const c = this.calls.get(`${residentId}/${callId}`);
    return c ? clone(c) : null;
  }

  async updateCall(residentId: string, callId: string, fn: (c: CallRecord) => CallRecord | null): Promise<CallRecord> {
    const key = `${residentId}/${callId}`;
    const c = this.calls.get(key);
    if (!c) throw new NotFoundError('Call');
    const next = fn(clone(c));
    if (!next) return clone(c);
    this.calls.set(key, clone(next));
    return clone(next);
  }

  async listCalls(residentId: string, opts: ListCallsOptions = {}): Promise<CallRecord[]> {
    const list = [...this.calls.values()]
      .filter((c) => c.residentId === residentId && (!opts.since || c.startedAt >= opts.since))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return (opts.limit ? list.slice(0, opts.limit) : list).map(clone);
  }

  async getCase(id: string): Promise<StoredCase | null> {
    const c = this.cases.get(id);
    return c ? clone(c) : null;
  }

  async putCase(c: StoredCase): Promise<void> {
    this.cases.set(c.id, clone(c));
  }

  async listOpenCases(): Promise<StoredCase[]> {
    return [...this.cases.values()].filter((c) => c.status !== 'closed').map(clone);
  }

  async listCasesByResident(residentId: string): Promise<StoredCase[]> {
    return [...this.cases.values()].filter((c) => c.residentId === residentId).map(clone);
  }

  async mutateCase(id: string, fn: (c: StoredCase) => CaseMutation): Promise<StoredCase> {
    const c = this.cases.get(id);
    if (!c) throw new NotFoundError('Case');
    const { case: next, events } = fn(clone(c));
    this.cases.set(id, clone(next));
    for (const e of events) this.events.set(e.id, clone(e));
    return clone(next);
  }

  async listCaseEvents(caseId: string): Promise<CaseEvent[]> {
    return [...this.events.values()].filter((e) => e.caseId === caseId).sort((a, b) => a.at.localeCompare(b.at)).map(clone);
  }

  async enqueueOutbox(entries: OutboxEntry[]): Promise<OutboxEntry[]> {
    const created: OutboxEntry[] = [];
    for (const e of entries) {
      if (this.outbox.has(e.id)) continue;
      this.outbox.set(e.id, clone(e));
      created.push(clone(e));
    }
    return created;
  }

  async listOutboxByCase(caseId: string): Promise<OutboxEntry[]> {
    return [...this.outbox.values()].filter((e) => e.caseId === caseId).map(clone);
  }

  async getOutbox(id: string): Promise<OutboxEntry | null> {
    const e = this.outbox.get(id);
    return e ? clone(e) : null;
  }

  async updateOutbox(id: string, fn: (e: OutboxEntry) => OutboxEntry | null): Promise<OutboxEntry> {
    const e = this.outbox.get(id);
    if (!e) throw new NotFoundError('Outbox entry');
    const next = fn(clone(e));
    if (!next) return clone(e);
    this.outbox.set(id, clone(next));
    return clone(next);
  }

  async listPendingOutbox(limit: number): Promise<OutboxEntry[]> {
    return this.outboxByStatus('pending', limit);
  }

  async listOutboxAwaitingApproval(limit: number): Promise<OutboxEntry[]> {
    return this.outboxByStatus('awaiting_approval', limit);
  }

  private outboxByStatus(status: OutboxStatus, limit: number): OutboxEntry[] {
    return [...this.outbox.values()].filter((e) => e.status === status).slice(0, limit).map(clone);
  }

  async getSpendLedger(month: string): Promise<SpendLedger | null> {
    const l = this.ledgers.get(month);
    return l ? clone(l) : null;
  }

  async mutateSpendLedger(month: string, fn: (l: SpendLedger) => SpendLedger | null): Promise<SpendLedger | null> {
    const current = this.ledgers.get(month) ?? emptyLedger(month, new Date(0).toISOString());
    const next = fn(clone(current));
    if (!next) return null;
    this.ledgers.set(month, clone(next));
    return clone(next);
  }
}
