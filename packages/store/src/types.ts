import type { SpendLedger } from '@hachi/core';
import type { CallRecord, CaseEvent, OutboxEntry, Resident, StoredCase } from './model.js';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export interface ListCallsOptions {
  /** Inclusive ISO lower bound on startedAt. */
  since?: string;
  limit?: number;
}

export interface CaseMutation {
  case: StoredCase;
  events: CaseEvent[];
}

export interface Store {
  createResident(r: Resident): Promise<void>;
  getResident(id: string): Promise<Resident | null>;
  updateResident(id: string, fn: (r: Resident) => Resident): Promise<Resident>;
  listResidents(): Promise<Resident[]>;
  listActiveResidents(): Promise<Resident[]>;
  findResidentsByFamilyContact(contact: string): Promise<Resident[]>;

  addCalls(calls: CallRecord[]): Promise<void>;
  /** Returns false (and writes nothing) if a call with the same id already exists. */
  createCallIfAbsent(call: CallRecord): Promise<boolean>;
  getCall(residentId: string, callId: string): Promise<CallRecord | null>;
  /** Atomic read-modify-write. Returning null from `fn` leaves the call unchanged. */
  updateCall(residentId: string, callId: string, fn: (c: CallRecord) => CallRecord | null): Promise<CallRecord>;
  /** Newest first. */
  listCalls(residentId: string, opts?: ListCallsOptions): Promise<CallRecord[]>;

  getCase(id: string): Promise<StoredCase | null>;
  putCase(c: StoredCase): Promise<void>;
  listOpenCases(): Promise<StoredCase[]>;
  listCasesByResident(residentId: string): Promise<StoredCase[]>;
  /** Atomically reads, transforms and writes a case together with its events. */
  mutateCase(id: string, fn: (c: StoredCase) => CaseMutation): Promise<StoredCase>;
  listCaseEvents(caseId: string): Promise<CaseEvent[]>;

  /** Creates entries whose id does not exist yet; returns only the newly created ones. */
  enqueueOutbox(entries: OutboxEntry[]): Promise<OutboxEntry[]>;
  listOutboxByCase(caseId: string): Promise<OutboxEntry[]>;
  getOutbox(id: string): Promise<OutboxEntry | null>;
  /** Atomic read-modify-write. Returning null from `fn` leaves the entry unchanged. */
  updateOutbox(id: string, fn: (e: OutboxEntry) => OutboxEntry | null): Promise<OutboxEntry>;
  /** Pending entries in no particular order. */
  listPendingOutbox(limit: number): Promise<OutboxEntry[]>;
  /** Entries held for a person's decision, in no particular order. */
  listOutboxAwaitingApproval(limit: number): Promise<OutboxEntry[]>;

  getSpendLedger(month: string): Promise<SpendLedger | null>;
  /**
   * Atomic read-modify-write of one month's AI spend, creating an empty month on first use.
   * Returning null from `fn` means the reservation was refused and nothing is written.
   */
  mutateSpendLedger(month: string, fn: (l: SpendLedger) => SpendLedger | null): Promise<SpendLedger | null>;
}
