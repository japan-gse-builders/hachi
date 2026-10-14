import { staffCallTask, type TaskQueue } from '@hachi/cloud';
import {
  claimSlot,
  emptyLedger,
  gatewayVerdict,
  hasCallConsent,
  HISTORY_CALLS,
  localDate,
  nextStaffCallSeq,
  PRIVACY_NOTICE,
  slotBusy,
  spendMonth,
  spendStatus,
  STAFF_REQUEST_HOLD_MS,
  staffCallCooldownLeft,
  staffCallId,
  type GatewayPolicy,
  type Locale,
  type SpendSettings,
} from '@hachi/core';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { auditEntry, requireRole, staffRef, type AuditInput } from './accounts.js';
import { registerAccountRoutes } from './accountRoutes.js';
import { familyContacts, toIdentity, type AuthAdmin, type FamilyPrincipal, type StaffPrincipal, type TokenVerifier } from './auth.js';
import { ID, ORG_HEADER, parse, requireIdentity, requireVerifiedEmail } from './request.js';
import { applyStaffUpdate } from './caseUpdate.js';
import {
  decideContactRequest,
  mayContactPeople,
  NotFoundError,
  orgMayContactPeople,
  type AccountStore,
  type Resident,
  type StaffRef,
  type Store,
} from '@hachi/store';
import { buildHeldRequests } from './contactRequests.js';
import { HttpError } from './errors.js';
import {
  addPushToken,
  assignResident,
  buildImportedCalls,
  buildResident,
  claimResident,
  FAMILY_ACCESS_MAX,
  grantFamilyAccess,
  isFamilyContact,
  isOwner,
  patchResident,
  releaseResident,
  revokeFamilyAccess,
  type GrantOutcome,
  type RevokeOutcome,
} from './residents.js';
import {
  callImportSchema,
  caseUpdateSchema,
  contactDecisionSchema,
  familyAccessSchema,
  ownerAssignSchema,
  pushTokenSchema,
  queueQuerySchema,
  residentInputSchema,
  residentPatchSchema,
} from './schemas.js';
import {
  analysisGaps,
  buildCaseDetail,
  buildFamilyDashboard,
  buildIncompleteAnalyses,
  buildQueue,
  buildSpendView,
  buildUnreached,
  callProgressView,
  FAMILY_WINDOW_DAYS,
  INCOMPLETE_DAYS,
  UNREACHED_LOOKBACK_DAYS,
  urgencyLegend,
  type MediaSigner,
} from './views.js';

export interface AppDeps {
  store: Store & AccountStore;
  verifier: TokenVerifier;
  /** Display names and "sign out everywhere" in Firebase itself; without it only Hachi's own records change. */
  authAdmin?: AuthAdmin;
  signer: MediaSigner;
  now?: () => Date;
  newId?: () => string;
  logger?: boolean;
  /** Browser origins allowed to call this API. Empty means same-origin only. */
  corsOrigins?: string[];
  /** Without it the spend route reports nothing, which is what local development wants. */
  spend?: SpendSettings;
  /** Lets "Call now" refuse up front when the conversation is known to be broken. */
  gateway?: GatewayPolicy;
  /**
   * Staff asking Hachi to call now (issue #13): the telephony service's dial queue. Without it the
   * route answers 503, which is what local development wants.
   */
  calls?: { queue: TaskQueue; cooldownMs: number };
}

export { HttpError, ORG_HEADER };

function requireFamily(req: FastifyRequest): FamilyPrincipal {
  const id = requireIdentity(req);
  const contacts = familyContacts(id);
  if (contacts.length === 0) throw new HttpError(403, 'Sign in with a verified phone number or email');
  return { kind: 'family', uid: id.uid, contacts };
}

/** A resident, case or held message of another organization is answered exactly like a missing one. */
function assertSameOrg(orgId: string | undefined, staff: StaffPrincipal, what: string): void {
  if (orgId !== staff.orgId) throw new NotFoundError(what);
}

/**
 * Changing a resident's record, and who in their family can read about them, is for the staff
 * member responsible for them. Checked inside the store's transaction, so a hand-over that lands
 * between reading and writing cannot let the previous owner through.
 */
function assertOwner(r: Resident, staffUid: string): void {
  if (isOwner(r, staffUid)) return;
  if (!r.owner) throw new HttpError(403, 'Nobody is responsible for this resident yet. Take them on first.', 'unassigned');
  const who = r.owner.name ?? r.owner.email ?? 'another member of staff';
  throw new HttpError(403, `Only the staff member responsible for ${r.name} (${who}) can change this.`, 'not_owner');
}

function localeOf(req: FastifyRequest): Locale {
  return (req.query as { locale?: string }).locale === 'en' ? 'en' : 'ja';
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { store, verifier, signer } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 5 * 1024 * 1024 });

  app.decorateRequest('identity', null);
  app.decorateRequest('staff', null);

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && deps.corsOrigins?.includes(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-headers', `Authorization, Content-Type, ${ORG_HEADER}`);
      reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return reply.status(204).send();
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token');
    try {
      req.identity = toIdentity(await verifier.verify(header.slice(7)));
    } catch {
      throw new HttpError(401, 'Invalid token');
    }
  });

  /**
   * Being staff is belonging to an organization: the membership is read on every request, so
   * removing someone, disabling them or signing them out everywhere takes effect at once.
   */
  const requireStaff = async (req: FastifyRequest): Promise<StaffPrincipal> => {
    if (req.staff) return req.staff;
    const id = requireVerifiedEmail(req);
    const requested = req.headers[ORG_HEADER];
    let membership;
    if (typeof requested === 'string' && requested !== '') {
      if (!ID.test(requested)) throw new HttpError(400, 'Unknown organization', 'organization_invalid');
      membership = await store.getMembership(requested, id.uid);
      if (!membership) throw new HttpError(403, 'You are not a member of this organization.', 'not_a_member');
    } else {
      const all = await store.listMembershipsByUser(id.uid);
      const active = all.filter((m) => m.status === 'active');
      if (active.length > 1) throw new HttpError(400, 'Choose which organization to act for.', 'organization_required');
      // Someone whose only membership is turned off is told so, not sent to create an organization.
      membership = active[0] ?? all[0];
      if (!membership) throw new HttpError(403, 'This account does not belong to an organization yet.', 'no_organization');
    }
    if (membership.status !== 'active') {
      throw new HttpError(403, 'Your access to this organization has been turned off. Ask one of its admins.', 'membership_disabled');
    }
    if (membership.sessionsValidAfter && (id.authTime ?? 0) < Date.parse(membership.sessionsValidAfter)) {
      throw new HttpError(401, 'You were signed out on every device. Sign in again.', 'session_revoked');
    }
    const org = await store.getOrganization(membership.orgId);
    if (!org) throw new HttpError(403, 'You are not a member of this organization.', 'not_a_member');
    if (org.status !== 'active') throw new HttpError(403, 'This organization is suspended. Contact Hachi support.', 'organization_suspended');
    req.staff = {
      kind: 'staff',
      uid: id.uid,
      email: id.email,
      // The name set in Hachi wins over the one in the token, which is only refreshed hourly.
      ...((membership.name ?? id.name) ? { name: membership.name ?? id.name } : {}),
      orgId: org.id,
      role: membership.role,
      org,
    };
    return req.staff;
  };

  /**
   * Written after the change it records has been saved. A failed write is logged rather than
   * undoing a change that already happened, so the log can miss an entry but never invent one.
   */
  const audit = async (req: FastifyRequest, orgId: string, actor: StaffRef, input: AuditInput): Promise<void> => {
    try {
      await store.appendAudit(auditEntry(orgId, actor, input, now(), newId()));
    } catch (err) {
      req.log.error({ orgId, action: input.action, err: (err as Error).message }, 'audit_write_failed');
    }
  };
  const auditAs = (req: FastifyRequest, staff: StaffPrincipal, input: AuditInput) => audit(req, staff.orgId, staffRef(staff), input);

  registerAccountRoutes(app, { store, authAdmin: deps.authAdmin, now, newId, requireStaff, audit });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, ...(err.reason ? { reason: err.reason } : {}) });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  app.get('/privacy-notice', async () => PRIVACY_NOTICE);

  // ---- Staff: residents (USR-01..04) ----

  /**
   * Counted before writing, so two registrations racing for the last place can both get in. The
   * limit is a plan allowance, not a safety bound, and one over is cheaper than a lock on every
   * registration.
   */
  app.post('/api/residents', async (req, reply) => {
    const staff = await requireStaff(req);
    const input = parse(residentInputSchema, req.body);
    const { limits } = staff.org.billing;
    if ((await store.listResidents(staff.orgId)).length >= limits.residents) {
      throw new HttpError(409, `This plan allows ${limits.residents} residents. Contact Hachi to raise the limit.`, 'resident_limit');
    }
    const resident = buildResident(input, newId(), staff.orgId, now(), staff);
    await store.createResident(resident);
    await auditAs(req, staff, { action: 'resident.created', target: { type: 'resident', id: resident.id, label: resident.name } });
    return reply.status(201).send(resident);
  });

  app.get('/api/residents', async (req) => {
    const staff = await requireStaff(req);
    return { residents: await store.listResidents(staff.orgId) };
  });

  const getResidentOr404 = async (id: string, staff: StaffPrincipal): Promise<Resident> => {
    const r = await store.getResident(id);
    if (!r) throw new NotFoundError('Resident');
    assertSameOrg(r.orgId, staff, 'Resident');
    return r;
  };

  /** Every change to a resident goes through here, so the organization check sits inside the transaction. */
  const updateOwnResident = (id: string, staff: StaffPrincipal, fn: (r: Resident) => Resident) =>
    store.updateResident(id, (r) => {
      assertSameOrg(r.orgId, staff, 'Resident');
      return fn(r);
    });

  app.get<{ Params: { id: string } }>('/api/residents/:id', async (req) => {
    const staff = await requireStaff(req);
    return getResidentOr404(req.params.id, staff);
  });

  app.patch<{ Params: { id: string } }>('/api/residents/:id', async (req) => {
    const staff = await requireStaff(req);
    const patch = parse(residentPatchSchema, req.body);
    const saved = await updateOwnResident(req.params.id, staff, (r) => {
      assertOwner(r, staff.uid);
      return patchResident(r, patch, now(), staff.uid);
    });
    await auditAs(req, staff, {
      action: 'resident.updated',
      target: { type: 'resident', id: saved.id, label: saved.name },
      detail: { fields: Object.keys(patch).sort().join(',') },
    });
    return saved;
  });

  // ---- Staff: who is responsible for a resident ----

  /** Taking on a resident nobody is responsible for. One already taken has to be handed over first. */
  app.post<{ Params: { id: string } }>('/api/residents/:id/owner', async (req) => {
    const staff = await requireStaff(req);
    let changed = false;
    const saved = await updateOwnResident(req.params.id, staff, (r) => {
      // Firestore may run this more than once; only the attempt that commits counts.
      changed = false;
      if (isOwner(r, staff.uid)) return r;
      if (r.owner) {
        const who = r.owner.name ?? r.owner.email ?? 'Another member of staff';
        throw new HttpError(409, `${who} is already responsible for ${r.name}. Ask them to hand ${r.preferredName} over.`, 'owned_by_other');
      }
      changed = true;
      return claimResident(r, staff, now());
    });
    if (changed) {
      await auditAs(req, staff, {
        action: 'resident.owner_changed',
        target: { type: 'resident', id: saved.id, label: saved.name },
        detail: { to: staff.uid, toName: staff.name ?? staff.email },
      });
    }
    return saved;
  });

  /** Handing a resident over: they become unassigned, for the next member of staff to take on. */
  app.delete<{ Params: { id: string } }>('/api/residents/:id/owner', async (req) => {
    const staff = await requireStaff(req);
    const saved = await updateOwnResident(req.params.id, staff, (r) => {
      assertOwner(r, staff.uid);
      return releaseResident(r, now());
    });
    await auditAs(req, staff, {
      action: 'resident.owner_changed',
      target: { type: 'resident', id: saved.id, label: saved.name },
      detail: { from: staff.uid, fromName: staff.name ?? staff.email },
    });
    return saved;
  });

  /**
   * An admin deciding who is responsible: for when the owner is away, has left, or the work is
   * being rebalanced. The new owner must be an active member of the same organization.
   */
  app.put<{ Params: { id: string } }>('/api/residents/:id/owner', async (req) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const { uid } = parse(ownerAssignSchema, req.body);
    const member = await store.getMembership(staff.orgId, uid);
    if (!member || member.status !== 'active') throw new HttpError(409, 'Choose an active member of this organization.', 'not_active_member');
    let from: Resident['owner'];
    let changed = false;
    const saved = await updateOwnResident(req.params.id, staff, (r) => {
      changed = false;
      if (isOwner(r, uid)) return r;
      from = r.owner;
      changed = true;
      return assignResident(r, { uid, email: member.email, ...(member.name ? { name: member.name } : {}) }, now());
    });
    if (changed) {
      const previous = from as Resident['owner'];
      await auditAs(req, staff, {
        action: 'resident.owner_changed',
        target: { type: 'resident', id: saved.id, label: saved.name },
        detail: {
          to: uid,
          toName: member.name ?? member.email,
          ...(previous ? { from: previous.uid, fromName: previous.name ?? previous.email ?? previous.uid } : {}),
        },
      });
    }
    return saved;
  });

  // ---- Staff: which family accounts can open a resident's dashboard (FAM-01) ----

  const grantRefusal = (outcome: GrantOutcome): Error | null => {
    if (outcome === 'family_contact') return new HttpError(409, 'This is the family contact’s address, which can already open the dashboard.', 'family_contact');
    if (outcome === 'full') return new HttpError(409, `Up to ${FAMILY_ACCESS_MAX} family accounts can have access. Remove one first.`, 'access_full');
    return null;
  };
  const revokeRefusal = (outcome: RevokeOutcome): Error | null => {
    if (outcome === 'family_contact') return new HttpError(409, 'This is the family contact’s address. Change the family contact to remove it.', 'family_contact');
    if (outcome === 'not_found') return new NotFoundError('Family access');
    return null;
  };

  /**
   * By email rather than by picking an account: nothing about who has signed up is shown to staff,
   * and the address works whether its owner registers before or after. Access only ever goes to an
   * account that has proved it holds the address (`familyContacts` only counts a verified email).
   */
  app.post<{ Params: { id: string } }>('/api/residents/:id/family-access', async (req, reply) => {
    const staff = await requireStaff(req);
    const { email } = parse(familyAccessSchema, req.body);
    let outcome: GrantOutcome = 'added';
    const saved = await updateOwnResident(req.params.id, staff, (r) => {
      assertOwner(r, staff.uid);
      const result = grantFamilyAccess(r, email, staff.uid, now());
      const refusal = grantRefusal(result.outcome);
      if (refusal) throw refusal;
      outcome = result.outcome;
      return result.resident;
    });
    if (outcome === 'added') {
      await auditAs(req, staff, { action: 'resident.family_access_granted', target: { type: 'resident', id: saved.id, label: saved.name }, detail: { email } });
    }
    return reply.status(outcome === 'added' ? 201 : 200).send({ outcome, familyAccess: saved.familyAccess ?? [] });
  });

  app.delete<{ Params: { id: string; email: string } }>('/api/residents/:id/family-access/:email', async (req) => {
    const staff = await requireStaff(req);
    const { email } = parse(familyAccessSchema, { email: req.params.email });
    let outcome: RevokeOutcome = 'removed';
    const saved = await updateOwnResident(req.params.id, staff, (r) => {
      assertOwner(r, staff.uid);
      const result = revokeFamilyAccess(r, email, now());
      const refusal = revokeRefusal(result.outcome);
      if (refusal) throw refusal;
      outcome = result.outcome;
      return result.resident;
    });
    await auditAs(req, staff, { action: 'resident.family_access_revoked', target: { type: 'resident', id: saved.id, label: saved.name }, detail: { email } });
    return { outcome, familyAccess: saved.familyAccess ?? [] };
  });

  app.post<{ Params: { id: string } }>('/api/residents/:id/calls/import', async (req, reply) => {
    const staff = await requireStaff(req);
    const input = parse(callImportSchema, req.body);
    const r = await getResidentOr404(req.params.id, staff);
    const calls = buildImportedCalls(r, input, newId, now());
    await store.addCalls(calls);
    return reply.status(201).send({ imported: calls.length, usableForBaseline: calls.filter((c) => c.speech?.usable).length });
  });

  // ---- Staff: ask Hachi to call a resident now (issue #13) ----

  /**
   * The same checks the daily check-in goes through, made here as well so staff hear why at once
   * rather than watching a call fail. The telephony service makes them again when it dials: this is
   * the explanation, that is the enforcement.
   */
  const callRefusal = async (r: Resident, staff: StaffPrincipal, t: Date): Promise<HttpError | null> => {
    if (r.synthetic) return new HttpError(409, 'This is a synthetic demo resident, not a real person, so Hachi does not call them', 'synthetic');
    if (!r.active) return new HttpError(409, 'Calls are paused for this resident. Resume them first.', 'paused');
    if (!hasCallConsent(r.callConsent)) return new HttpError(409, 'The resident has not agreed to calls from Hachi yet', 'consent_required');
    if (!mayContactPeople(staff.org)) {
      return new HttpError(409, 'Hachi has not verified your organization yet, so it does not call residents for it', 'organization_unverified');
    }
    if (deps.spend) {
      const month = spendMonth(t);
      const ledger = (await store.getSpendLedger(month)) ?? emptyLedger(month, t.toISOString());
      if (spendStatus(ledger, deps.spend.policy).paused) {
        return new HttpError(409, "This month's AI budget is used up, so Hachi is not placing calls", 'budget_exhausted');
      }
    }
    if (deps.gateway && gatewayVerdict(await store.getGatewayBreaker(), t, deps.gateway) === 'down') {
      return new HttpError(409, "Hachi's conversations are not working at the moment, so the call would only end in an apology", 'gateway_unavailable');
    }
    return null;
  };

  app.post<{ Params: { id: string } }>('/api/residents/:id/calls', async (req, reply) => {
    const staff = await requireStaff(req);
    if (!deps.calls) throw new HttpError(503, 'Calling from this screen is not set up on this server', 'not_configured');
    const { queue, cooldownMs } = deps.calls;
    const r = await getResidentOr404(req.params.id, staff);
    const t = now();
    const refusal = await callRefusal(r, staff, t);
    if (refusal) throw refusal;

    // The cooldown spares the resident a second ring too soon. A call that went wrong on our side
    // (refused, line busy, a fault while dialling or mid-call, or a request that never reached the
    // telephony service) is no reason to make staff wait, so it does not count; one that rang and
    // was not answered still does. A late task for the old request cannot ring as well: it would
    // find the line held by the new one.
    const last = r.lastStaffCall;
    const lastCall = last ? await store.getCall(r.id, last.callId) : null;
    const lastFaulted = last
      ? lastCall
        ? !!lastCall.failure
        : t.getTime() - Date.parse(last.at) > STAFF_REQUEST_HOLD_MS
      : false;

    // The line and the cooldown are decided in one transaction, so two members of staff pressing at
    // once get one call between them.
    type Outcome = { kind: 'busy'; callId: string } | { kind: 'cooldown'; ms: number } | { kind: 'ok'; callId: string; date: string; seq: number };
    let outcome = { kind: 'busy', callId: '' } as Outcome;
    let previous: Resident['lastStaffCall'];
    await store.updateResident(r.id, (cur) => {
      previous = cur.lastStaffCall;
      if (slotBusy(cur.callSlot, t)) {
        outcome = { kind: 'busy', callId: cur.callSlot!.callId };
        return cur;
      }
      const faulted = lastFaulted && cur.lastStaffCall?.callId === last?.callId;
      const wait = faulted ? 0 : staffCallCooldownLeft(cur.lastStaffCall?.at, t, cooldownMs);
      if (wait > 0) {
        outcome = { kind: 'cooldown', ms: wait };
        return cur;
      }
      const date = localDate(t, cur.timeZone);
      const seq = nextStaffCallSeq(date, cur.lastStaffCall?.callId);
      const callId = staffCallId(date, seq);
      outcome = { kind: 'ok', callId, date, seq };
      return {
        ...cur,
        callSlot: claimSlot(undefined, callId, t, STAFF_REQUEST_HOLD_MS)!,
        lastStaffCall: { callId, at: t.toISOString(), requestedBy: staff.uid },
      };
    });
    if (outcome.kind === 'busy') {
      return reply.status(409).send({ error: `Hachi is already on the phone to ${r.name}, or about to be`, reason: 'call_in_progress', callId: outcome.callId });
    }
    if (outcome.kind === 'cooldown') {
      const sec = Math.ceil(outcome.ms / 1000);
      return reply
        .status(429)
        .header('retry-after', String(sec))
        .send({ error: `Hachi called ${r.name} a few minutes ago. You can ask again in ${Math.ceil(sec / 60)} min.`, reason: 'cooldown', retryAfterSec: sec });
    }

    const { callId, date, seq } = outcome;
    try {
      await queue.enqueue(staffCallTask(r.id, date, seq, staff.uid));
    } catch (err) {
      // Nothing will dial, so neither the line nor the cooldown should hold anyone back.
      await store.updateResident(r.id, (cur) => {
        if (cur.lastStaffCall?.callId !== callId) return cur;
        const { callSlot, lastStaffCall: _last, ...rest } = cur;
        return { ...rest, ...(callSlot && callSlot.callId !== callId ? { callSlot } : {}), ...(previous ? { lastStaffCall: previous } : {}) };
      });
      req.log.error({ residentId: r.id, callId, err: (err as Error).message }, 'could not queue a staff call');
      throw new HttpError(503, 'The call could not be queued. Please try again.', 'queue_unavailable');
    }
    req.log.info({ residentId: r.id, callId, by: staff.uid }, 'staff asked Hachi to call');
    return reply.status(202).send({ callId, status: 'requested' });
  });

  /** One call's progress, so the "Call now" button can say ringing, on the call, or ended. */
  app.get<{ Params: { id: string; callId: string } }>('/api/residents/:id/calls/:callId', async (req) => {
    const staff = await requireStaff(req);
    if (!ID.test(req.params.callId)) throw new NotFoundError('Call');
    const r = await getResidentOr404(req.params.id, staff);
    const view = callProgressView(req.params.callId, await store.getCall(r.id, req.params.callId), r, now());
    if (!view) throw new NotFoundError('Call');
    return view;
  });

  // ---- Staff: triage queue and cases (QUE-01..03) ----

  /** Each active resident with their calls since `since`. */
  const recentCalls = (residents: Resident[], since: Date) =>
    Promise.all(
      residents.filter((r) => r.active).map(async (r) => ({ resident: r, calls: await store.listCalls(r.id, { since: since.toISOString() }) })),
    );

  /**
   * The queue carries the residents nobody reached as well as the cases, because the two answer the
   * same question and only one of them can be built from what a call found. A resident whose call
   * never connected raises no detection and so has no case; without this they are simply absent
   * from the screen, which is indistinguishable from a day on which they were fine.
   */
  app.get('/api/queue', async (req) => {
    const staff = await requireStaff(req);
    const { includeClosed } = parse(queueQuerySchema, req.query);
    const [openCases, residents] = await Promise.all([store.listOpenCases(staff.orgId), store.listResidents(staff.orgId)]);
    const locale = localeOf(req);
    const t = now();
    // One read covers both lists: the unreached lookback is the longer window.
    const entries = await recentCalls(residents, new Date(t.getTime() - Math.max(UNREACHED_LOOKBACK_DAYS, INCOMPLETE_DAYS) * 86_400_000));
    const byId = new Map(residents.map((r) => [r.id, r]));
    const openItems = buildQueue(openCases, byId, t, locale);
    const cases = includeClosed === 'true' ? (await Promise.all(residents.map((r) => store.listCasesByResident(r.id)))).flat() : null;
    return {
      items: cases ? buildQueue(cases, byId, t, locale) : openItems,
      summary: {
        needsAttention: openItems.filter((c) => c.urgency !== 'watch').length,
        monitor: openItems.filter((c) => c.urgency === 'watch').length,
        residents: residents.length,
      },
      legend: urgencyLegend(locale),
      unreached: buildUnreached(entries, t, locale),
      incomplete: buildIncompleteAnalyses(entries, t, locale),
    };
  });

  /** Issue #11: the same list for the residents page, without the cases it does not show. */
  app.get('/api/incomplete-analyses', async (req) => {
    const staff = await requireStaff(req);
    const t = now();
    const entries = await recentCalls(await store.listResidents(staff.orgId), new Date(t.getTime() - INCOMPLETE_DAYS * 86_400_000));
    return buildIncompleteAnalyses(entries, t, localeOf(req));
  });

  /**
   * Asks for a call whose analysis did not finish to be analysed again. It only marks the call
   * pending: the analyzer's sweep, which runs every few minutes, is what queues the work, so the API
   * needs no access to the analyzer's queue. Refused for calls that have nothing missing, because a
   * second pass costs a model request and finds nothing new. A call already waiting is not an error:
   * another member of staff got there first, and the pass they asked for is the one this would be.
   */
  app.post<{ Params: { id: string; callId: string } }>('/api/residents/:id/calls/:callId/reanalysis', async (req, reply) => {
    const staff = await requireStaff(req);
    if (!ID.test(req.params.callId)) throw new NotFoundError('Call');
    const r = await getResidentOr404(req.params.id, staff);
    // The sweep only looks at residents whose calls are running.
    if (!r.active) throw new HttpError(409, 'Calls are paused for this resident, so the call cannot be analyzed again until they are resumed');
    const existing = await store.getCall(r.id, req.params.callId);
    if (!existing) throw new NotFoundError('Call');
    const requestedAt = now().toISOString();
    let outcome = 'requested' as 'requested' | 'already_pending' | 'complete';
    await store.updateCall(r.id, existing.id, (c) => {
      outcome = c.analysisPending ? 'already_pending' : analysisGaps(c).length === 0 ? 'complete' : 'requested';
      return outcome === 'requested' ? { ...c, analysisPending: true, reanalysis: { requestedAt, requestedBy: staff.uid } } : null;
    });
    if (outcome === 'complete') throw new HttpError(409, 'This call was fully analyzed; there is nothing to check again');
    if (outcome === 'already_pending') return reply.status(202).send({ status: 'already_pending' });
    req.log.info({ residentId: r.id, callId: existing.id, by: staff.uid }, 'reanalysis requested');
    return reply.status(202).send({ status: 'requested', requestedAt });
  });

  /**
   * This month's AI spend. Staff see it because when calls stop going out they are the ones who
   * will be asked why, and "the budget is used up" is an answer they can act on.
   */
  app.get('/api/spend', async (req) => {
    const staff = await requireStaff(req);
    if (!deps.spend) return null;
    const month = spendMonth(now());
    const ledger = (await store.getSpendLedger(month)) ?? emptyLedger(month, now().toISOString());
    const view = buildSpendView(ledger, deps.spend.policy, localeOf(req));
    if (staff.org.billing.plan === 'internal') return view;
    // The budget is the whole deployment's, so a customer sees only whether it has stopped their calls.
    if (!view.paused) return null;
    return {
      month: view.month,
      paused: true,
      note: localeOf(req) === 'ja'
        ? '今月は新しい見守り通話を止めています。緊急時の連絡は止まりません。'
        : 'New check-in calls have stopped for this month. Emergency contact is unaffected.',
    };
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    const staff = await requireStaff(req);
    const c = await store.getCase(req.params.id);
    if (!c) throw new NotFoundError('Case');
    assertSameOrg(c.orgId, staff, 'Case');
    const [r, residentCases, calls, events] = await Promise.all([
      getResidentOr404(c.residentId, staff),
      store.listCasesByResident(c.residentId),
      store.listCalls(c.residentId, { limit: HISTORY_CALLS }),
      store.listCaseEvents(c.id),
    ]);
    return buildCaseDetail(c, r, residentCases, calls, events, signer, now(), localeOf(req));
  });

  app.patch<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    const staff = await requireStaff(req);
    const update = parse(caseUpdateSchema, req.body);
    const saved = await store.mutateCase(req.params.id, (c) => {
      assertSameOrg(c.orgId, staff, 'Case');
      return applyStaffUpdate(c, update, staff.uid, now(), newId);
    });
    await auditAs(req, staff, {
      action: 'case.updated',
      target: { type: 'case', id: req.params.id },
      detail: { fields: Object.keys(update).filter((k) => k !== 'reason').sort().join(',') },
    });
    return saved;
  });

  // ---- Family dashboard (FAM-01..04) ----

  /**
   * Only residents of organizations Hachi has verified: any organization can type in a family
   * address, and an unverified one must not be able to appear on a stranger's dashboard.
   */
  const familyResidents = async (contacts: string[]): Promise<Resident[]> => {
    const lists = await Promise.all(contacts.map((c) => store.findResidentsByFamilyContact(c)));
    const residents = [...new Map(lists.flat().map((r) => [r.id, r])).values()];
    const orgIds = [...new Set(residents.map((r) => r.orgId).filter(Boolean))];
    const verified = new Set(
      (await Promise.all(orgIds.map(async (id) => ((await orgMayContactPeople(store, id)) ? id : null)))).filter((id) => id !== null),
    );
    return residents.filter((r) => verified.has(r.orgId));
  };

  app.get('/api/family/residents', async (req) => {
    const fam = requireFamily(req);
    const residents = await familyResidents(fam.contacts);
    return { residents: residents.map((r) => ({ id: r.id, name: r.name })) };
  });

  app.get<{ Params: { id: string } }>('/api/family/residents/:id/dashboard', async (req) => {
    const fam = requireFamily(req);
    const r = await store.getResident(req.params.id);
    // Same response for "missing" and "not yours" so residents cannot be enumerated.
    if (!r || !r.familyLookup.some((c) => fam.contacts.includes(c)) || !(await orgMayContactPeople(store, r.orgId))) {
      throw new NotFoundError('Resident');
    }
    const t = now();
    const since = new Date(t.getTime() - FAMILY_WINDOW_DAYS * 86_400_000).toISOString();
    const [calls, cases] = await Promise.all([store.listCalls(r.id, { since }), store.listCasesByResident(r.id)]);
    return { ...buildFamilyDashboard(r, calls, cases, t, localeOf(req)), receivesAlerts: isFamilyContact(r, fam.contacts) };
  });

  // ---- Contact requests the resident made by phone (CNV-15, NTF-05) ----

  /**
   * A number the resident read out is one misheard digit away from a stranger, so the message
   * waits for a person. Either their care staff or their own family may decide: the family often
   * knows the number by heart, and staff are not always at a screen.
   */
  /**
   * Staff and family have a route each: one account can be both (a care worker whose own mother
   * uses Hachi), and which hat it is wearing must come from the screen, not be guessed.
   */
  const decide = async (id: string, visible: Map<string, Resident>, orgId: string | null, by: 'staff' | 'family', uid: string, decision: 'approve' | 'reject') => {
    const entry = await store.getOutbox(id);
    // One answer for "no such request" and "not yours", so requests cannot be enumerated.
    if (!entry || entry.kind !== 'contact_request' || !visible.has(entry.residentId) || (orgId !== null && entry.orgId !== orgId)) {
      throw new NotFoundError('Contact request');
    }
    const { outcome } = await decideContactRequest(store, entry.id, {
      by,
      uid,
      at: now().toISOString(),
      decision: decision === 'approve' ? 'approved' : 'rejected',
    });
    // Approving only queues it; the notification worker's sweep is what sends it.
    return { outcome, residentId: entry.residentId };
  };

  const staffVisible = async (staff: StaffPrincipal) => new Map((await store.listResidents(staff.orgId)).map((r) => [r.id, r]));
  const familyVisible = async (fam: FamilyPrincipal) => new Map((await familyResidents(fam.contacts)).map((r) => [r.id, r]));

  app.get('/api/contact-requests', async (req) => {
    const staff = await requireStaff(req);
    return { requests: buildHeldRequests(await store.listOutboxAwaitingApproval(staff.orgId, 100), await staffVisible(staff)) };
  });

  app.post<{ Params: { id: string } }>('/api/contact-requests/:id', async (req) => {
    const staff = await requireStaff(req);
    const { decision } = parse(contactDecisionSchema, req.body);
    const visible = await staffVisible(staff);
    const { outcome, residentId } = await decide(req.params.id, visible, staff.orgId, 'staff', staff.uid, decision);
    const r = visible.get(residentId);
    await auditAs(req, staff, {
      action: 'resident.contact_request_decided',
      target: { type: 'resident', id: residentId, ...(r ? { label: r.name } : {}) },
      detail: { decision, outcome },
    });
    return { outcome };
  });

  app.get('/api/family/contact-requests', async (req) => {
    const fam = requireFamily(req);
    const visible = await familyVisible(fam);
    const orgs = [...new Set([...visible.values()].map((r) => r.orgId))];
    const held = (await Promise.all(orgs.map((o) => store.listOutboxAwaitingApproval(o, 100)))).flat();
    return { requests: buildHeldRequests(held, visible) };
  });

  app.post<{ Params: { id: string } }>('/api/family/contact-requests/:id', async (req) => {
    const fam = requireFamily(req);
    const { decision } = parse(contactDecisionSchema, req.body);
    const visible = await familyVisible(fam);
    const { outcome, residentId } = await decide(req.params.id, visible, null, 'family', fam.uid, decision);
    const r = visible.get(residentId);
    if (r?.orgId) {
      const email = req.identity?.email;
      await audit(req, r.orgId, { uid: fam.uid, ...(email ? { email } : {}) }, {
        action: 'resident.contact_request_decided',
        target: { type: 'resident', id: residentId, label: r.name },
        detail: { decision, outcome, by: 'family' },
      });
    }
    return { outcome };
  });

  app.post('/api/family/push-tokens', async (req, reply) => {
    const fam = requireFamily(req);
    const { token } = parse(pushTokenSchema, req.body);
    // Alerts belong to the family contact. A relative who may only view would otherwise receive
    // them, and keep receiving them after their access was removed.
    const residents = (await familyResidents(fam.contacts)).filter((r) => isFamilyContact(r, fam.contacts));
    await Promise.all(residents.map((r) => store.updateResident(r.id, (cur) => (isFamilyContact(cur, fam.contacts) ? addPushToken(cur, token) : cur))));
    return reply.status(204).send();
  });

  return app;
}
