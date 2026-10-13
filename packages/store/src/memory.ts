import { emptyLedger, healthyGateway, type GatewayBreaker, type SpendLedger } from '@hachi/core';
import { byJoined, membershipId, type AuditEntry, type Invitation, type Membership, type Organization } from './accounts.js';
import type { CallRecord, CaseEvent, OutboxEntry, OutboxStatus, Resident, StoredCase } from './model.js';
import { NotFoundError, type AccountStore, type CaseMutation, type ListCallsOptions, type Roster, type Store } from './types.js';

const clone = <T>(v: T): T => structuredClone(v);
const byName = (a: Resident, b: Resident) => a.name.localeCompare(b.name);

/** Store used in tests and local development; same semantics as the Firestore store. */
export class MemoryStore implements Store, AccountStore {
  private orgs = new Map<string, Organization>();
  private memberships = new Map<string, Membership>();
  private invitations = new Map<string, Invitation>();
  private audit: AuditEntry[] = [];
  private residents = new Map<string, Resident>();
  private calls = new Map<string, CallRecord>();
  private cases = new Map<string, StoredCase>();
  private events = new Map<string, CaseEvent>();
  private outbox = new Map<string, OutboxEntry>();
  private ledgers = new Map<string, SpendLedger>();
  private breaker: GatewayBreaker | null = null;

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

  async listResidents(orgId: string): Promise<Resident[]> {
    return [...this.residents.values()].filter((r) => r.orgId === orgId).map(clone).sort(byName);
  }

  async listActiveResidents(): Promise<Resident[]> {
    return [...this.residents.values()].filter((r) => r.active).map(clone).sort(byName);
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

  async listOpenCases(orgId: string): Promise<StoredCase[]> {
    return [...this.cases.values()].filter((c) => c.orgId === orgId && c.status !== 'closed').map(clone);
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

  async listOutboxAwaitingApproval(orgId: string, limit: number): Promise<OutboxEntry[]> {
    return this.outboxByStatus('awaiting_approval', limit, orgId);
  }

  private outboxByStatus(status: OutboxStatus, limit: number, orgId?: string): OutboxEntry[] {
    return [...this.outbox.values()]
      .filter((e) => e.status === status && (orgId === undefined || e.orgId === orgId))
      .slice(0, limit)
      .map(clone);
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

  async getGatewayBreaker(): Promise<GatewayBreaker | null> {
    return this.breaker ? clone(this.breaker) : null;
  }

  async mutateGatewayBreaker(fn: (b: GatewayBreaker) => GatewayBreaker | null): Promise<GatewayBreaker | null> {
    const next = fn(clone(this.breaker ?? healthyGateway(new Date(0).toISOString())));
    if (!next) return null;
    this.breaker = clone(next);
    return clone(next);
  }

  // ---- Accounts ----

  /** For tests and the local preview: organizations and members in place before anything runs. */
  seedAccounts(seed: { organizations?: Organization[]; memberships?: Membership[] }): void {
    for (const o of seed.organizations ?? []) this.orgs.set(o.id, clone(o));
    for (const m of seed.memberships ?? []) this.memberships.set(membershipId(m.orgId, m.uid), clone(m));
  }

  async createOrganization(org: Organization, owner: Membership): Promise<void> {
    if (this.orgs.has(org.id)) throw new Error(`Organization ${org.id} already exists`);
    this.orgs.set(org.id, clone(org));
    this.memberships.set(membershipId(owner.orgId, owner.uid), clone(owner));
  }

  async getOrganization(id: string): Promise<Organization | null> {
    const o = this.orgs.get(id);
    return o ? clone(o) : null;
  }

  async updateOrganization(id: string, fn: (o: Organization) => Organization): Promise<Organization> {
    const o = this.orgs.get(id);
    if (!o) throw new NotFoundError('Organization');
    const next = fn(clone(o));
    this.orgs.set(id, clone(next));
    return clone(next);
  }

  async getMembership(orgId: string, uid: string): Promise<Membership | null> {
    const m = this.memberships.get(membershipId(orgId, uid));
    return m ? clone(m) : null;
  }

  // Read-modify-write methods below never await between reading and writing, so like Firestore's
  // transactions each one sees and changes a single consistent state.

  private membersOf(orgId: string): Membership[] {
    return [...this.memberships.values()].filter((m) => m.orgId === orgId).map(clone).sort(byJoined);
  }

  private pendingOf(orgId: string): Invitation[] {
    return [...this.invitations.values()].filter((i) => i.orgId === orgId && i.status === 'pending').map(clone);
  }

  async listMembers(orgId: string): Promise<Membership[]> {
    return this.membersOf(orgId);
  }

  async listMembershipsByUser(uid: string): Promise<Membership[]> {
    return [...this.memberships.values()].filter((m) => m.uid === uid).map(clone).sort(byJoined);
  }

  async mutateMembership(orgId: string, uid: string, fn: (m: Membership, roster: Roster) => Membership | null): Promise<Membership | null> {
    const key = membershipId(orgId, uid);
    const m = this.memberships.get(key);
    if (!m) throw new NotFoundError('Member');
    const next = fn(clone(m), { members: this.membersOf(orgId), pending: this.pendingOf(orgId) });
    if (next) this.memberships.set(key, clone(next));
    else this.memberships.delete(key);
    return next ? clone(next) : null;
  }

  async updateMembershipsOfUser(uid: string, fn: (m: Membership) => Membership): Promise<Membership[]> {
    const next = [...this.memberships.values()].filter((m) => m.uid === uid).map((m) => fn(clone(m)));
    for (const m of next) this.memberships.set(membershipId(m.orgId, m.uid), clone(m));
    return next.map(clone);
  }

  async createInvitation(inv: Invitation, guard: (roster: Roster) => void): Promise<void> {
    guard({ members: this.membersOf(inv.orgId), pending: this.pendingOf(inv.orgId) });
    if (this.invitations.has(inv.id)) throw new Error(`Invitation ${inv.id} already exists`);
    this.invitations.set(inv.id, clone(inv));
  }

  async getInvitation(id: string): Promise<Invitation | null> {
    const i = this.invitations.get(id);
    return i ? clone(i) : null;
  }

  async listPendingInvitations(orgId: string): Promise<Invitation[]> {
    return this.pendingOf(orgId);
  }

  async listPendingInvitationsByEmail(email: string): Promise<Invitation[]> {
    return [...this.invitations.values()].filter((i) => i.email === email && i.status === 'pending').map(clone);
  }

  async updateInvitation(id: string, fn: (i: Invitation) => Invitation): Promise<Invitation> {
    const i = this.invitations.get(id);
    if (!i) throw new NotFoundError('Invitation');
    const next = fn(clone(i));
    this.invitations.set(id, clone(next));
    return clone(next);
  }

  async acceptInvitation(
    id: string,
    uid: string,
    fn: (inv: Invitation, existing: Membership | null, members: Membership[]) => { invitation: Invitation; membership: Membership },
  ): Promise<Membership> {
    const inv = this.invitations.get(id);
    if (!inv) throw new NotFoundError('Invitation');
    const members = this.membersOf(inv.orgId);
    const { invitation, membership } = fn(clone(inv), members.find((m) => m.uid === uid) ?? null, members);
    if (membership.orgId !== inv.orgId || membership.uid !== uid) throw new Error('An invitation only makes its own invitee a member of its own organization');
    this.invitations.set(id, clone(invitation));
    this.memberships.set(membershipId(membership.orgId, membership.uid), clone(membership));
    return clone(membership);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(clone(entry));
  }

  async listAudit(orgId: string, opts: { limit: number; before?: string }): Promise<AuditEntry[]> {
    return this.audit
      .filter((e) => e.orgId === orgId && (!opts.before || e.id < opts.before))
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, opts.limit)
      .map(clone);
  }
}
