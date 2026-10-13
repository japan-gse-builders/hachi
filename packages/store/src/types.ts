import type { GatewayBreaker, SpendLedger } from '@hachi/core';
import type { AuditEntry, Invitation, Membership, Organization } from './accounts.js';
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
  /** One organization's residents, by name. */
  listResidents(orgId: string): Promise<Resident[]>;
  /** Every organization's: for the workers that place and check calls, never for a person. */
  listActiveResidents(): Promise<Resident[]>;
  findResidentsByFamilyContact(contact: string): Promise<Resident[]>;
  /** Here as well as in `AccountStore`: the workers ask it whether they may reach people (`mayContactPeople`). */
  getOrganization(id: string): Promise<Organization | null>;

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
  listOpenCases(orgId: string): Promise<StoredCase[]>;
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
  /** One organization's entries held for a person's decision, in no particular order. */
  listOutboxAwaitingApproval(orgId: string, limit: number): Promise<OutboxEntry[]>;

  getSpendLedger(month: string): Promise<SpendLedger | null>;
  /**
   * Atomic read-modify-write of one month's AI spend, creating an empty month on first use.
   * Returning null from `fn` means the reservation was refused and nothing is written.
   */
  mutateSpendLedger(month: string, fn: (l: SpendLedger) => SpendLedger | null): Promise<SpendLedger | null>;

  getGatewayBreaker(): Promise<GatewayBreaker | null>;
  /**
   * Atomic read-modify-write of what is known about the Voice Gateway. Returning null from `fn`
   * means the call must not be placed and nothing is written.
   */
  mutateGatewayBreaker(fn: (b: GatewayBreaker) => GatewayBreaker | null): Promise<GatewayBreaker | null>;
}

/** An organization's members and pending invitations, read together; what seat limits count. */
export interface Roster {
  members: Membership[];
  pending: Invitation[];
}

/**
 * Organizations, who belongs to them, and what they did. Only the API uses it; the workers that
 * place and check calls never need to know who works where, only whether the organization is
 * verified (`Store.getOrganization`).
 *
 * Every `fn` and guard runs inside the store's transaction and may throw to abort it: invariants
 * such as "an organization always has an active owner" are checked against what is stored at
 * the moment of writing, not against an earlier read.
 */
export interface AccountStore {
  /** Creates the organization and its first owner together. */
  createOrganization(org: Organization, owner: Membership): Promise<void>;
  getOrganization(id: string): Promise<Organization | null>;
  updateOrganization(id: string, fn: (o: Organization) => Organization): Promise<Organization>;

  getMembership(orgId: string, uid: string): Promise<Membership | null>;
  listMembers(orgId: string): Promise<Membership[]>;
  listMembershipsByUser(uid: string): Promise<Membership[]>;
  /**
   * `fn` sees the membership and the organization's roster, as stored now. Returning null removes
   * the membership. Throws NotFoundError when there is no such membership.
   */
  mutateMembership(orgId: string, uid: string, fn: (m: Membership, roster: Roster) => Membership | null): Promise<Membership | null>;
  /** Applies `fn` to every organization the account belongs to, in one transaction. */
  updateMembershipsOfUser(uid: string, fn: (m: Membership) => Membership): Promise<Membership[]>;

  /** `guard` may throw to refuse, e.g. when the organization is full or the address already invited. */
  createInvitation(inv: Invitation, guard: (roster: Roster) => void): Promise<void>;
  getInvitation(id: string): Promise<Invitation | null>;
  listPendingInvitations(orgId: string): Promise<Invitation[]>;
  listPendingInvitationsByEmail(email: string): Promise<Invitation[]>;
  updateInvitation(id: string, fn: (i: Invitation) => Invitation): Promise<Invitation>;
  /**
   * Accepting writes the invitation and the membership together, so an invitation can never be
   * used twice nor leave a member without the record of how they joined.
   */
  acceptInvitation(
    id: string,
    uid: string,
    fn: (inv: Invitation, existing: Membership | null, members: Membership[]) => { invitation: Invitation; membership: Membership },
  ): Promise<Membership>;

  appendAudit(entry: AuditEntry): Promise<void>;
  /** Newest first, by id (see `auditId`); `before` is the id of the last entry already shown. */
  listAudit(orgId: string, opts: { limit: number; before?: string }): Promise<AuditEntry[]>;
}
