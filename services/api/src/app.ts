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
import { ZodError, type ZodType } from 'zod';
import { toPrincipal, type Principal, type TokenVerifier } from './auth.js';
import { applyStaffUpdate } from './caseUpdate.js';
import { decideContactRequest, NotFoundError, type Resident, type Store } from '@hachi/store';
import { buildHeldRequests } from './contactRequests.js';
import {
  addPushToken,
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
  store: Store;
  verifier: TokenVerifier;
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

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /** A stable code for the app to act on; the message is for people. */
    readonly reason?: string,
  ) {
    super(message);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function requireStaff(req: FastifyRequest): Extract<Principal, { kind: 'staff' }> {
  if (req.principal?.kind !== 'staff') throw new HttpError(403, 'Staff only');
  return req.principal;
}

function requireFamily(req: FastifyRequest): Extract<Principal, { kind: 'family' }> {
  if (req.principal?.kind !== 'family') throw new HttpError(403, 'Family only');
  return req.principal;
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

  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && deps.corsOrigins?.includes(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-headers', 'Authorization, Content-Type');
      reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return reply.status(204).send();
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token');
    let principal: Principal | null;
    try {
      principal = toPrincipal(await verifier.verify(header.slice(7)));
    } catch {
      throw new HttpError(401, 'Invalid token');
    }
    if (!principal) throw new HttpError(403, 'Sign in with a verified phone number or email');
    req.principal = principal;
  });

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

  app.post('/api/residents', async (req, reply) => {
    const staff = requireStaff(req);
    const input = parse(residentInputSchema, req.body);
    const resident = buildResident(input, newId(), now(), staff);
    await store.createResident(resident);
    return reply.status(201).send(resident);
  });

  app.get('/api/residents', async (req) => {
    requireStaff(req);
    return { residents: await store.listResidents() };
  });

  const getResidentOr404 = async (id: string): Promise<Resident> => {
    const r = await store.getResident(id);
    if (!r) throw new NotFoundError('Resident');
    return r;
  };

  app.get<{ Params: { id: string } }>('/api/residents/:id', async (req) => {
    requireStaff(req);
    return getResidentOr404(req.params.id);
  });

  app.patch<{ Params: { id: string } }>('/api/residents/:id', async (req) => {
    const staff = requireStaff(req);
    const patch = parse(residentPatchSchema, req.body);
    return store.updateResident(req.params.id, (r) => {
      assertOwner(r, staff.uid);
      return patchResident(r, patch, now(), staff.uid);
    });
  });

  // ---- Staff: who is responsible for a resident ----

  /** Taking on a resident nobody is responsible for. One already taken has to be handed over first. */
  app.post<{ Params: { id: string } }>('/api/residents/:id/owner', async (req) => {
    const staff = requireStaff(req);
    const saved = await store.updateResident(req.params.id, (r) => {
      if (isOwner(r, staff.uid)) return r;
      if (r.owner) {
        const who = r.owner.name ?? r.owner.email ?? 'Another member of staff';
        throw new HttpError(409, `${who} is already responsible for ${r.name}. Ask them to hand ${r.preferredName} over.`, 'owned_by_other');
      }
      return claimResident(r, staff, now());
    });
    req.log.info({ residentId: saved.id, by: staff.uid, action: 'resident_taken_on' }, 'resident ownership');
    return saved;
  });

  /** Handing a resident over: they become unassigned, for the next member of staff to take on. */
  app.delete<{ Params: { id: string } }>('/api/residents/:id/owner', async (req) => {
    const staff = requireStaff(req);
    const saved = await store.updateResident(req.params.id, (r) => {
      assertOwner(r, staff.uid);
      return releaseResident(r, now());
    });
    req.log.info({ residentId: saved.id, by: staff.uid, action: 'resident_handed_over' }, 'resident ownership');
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
   * account that has proved it holds the address (`toPrincipal` requires a verified email).
   */
  app.post<{ Params: { id: string } }>('/api/residents/:id/family-access', async (req, reply) => {
    const staff = requireStaff(req);
    const { email } = parse(familyAccessSchema, req.body);
    let outcome: GrantOutcome = 'added';
    const saved = await store.updateResident(req.params.id, (r) => {
      assertOwner(r, staff.uid);
      const result = grantFamilyAccess(r, email, staff.uid, now());
      const refusal = grantRefusal(result.outcome);
      if (refusal) throw refusal;
      outcome = result.outcome;
      return result.resident;
    });
    if (outcome === 'added') req.log.info({ residentId: saved.id, by: staff.uid, action: 'family_access_granted' }, 'family access');
    return reply.status(outcome === 'added' ? 201 : 200).send({ outcome, familyAccess: saved.familyAccess ?? [] });
  });

  app.delete<{ Params: { id: string; email: string } }>('/api/residents/:id/family-access/:email', async (req) => {
    const staff = requireStaff(req);
    const { email } = parse(familyAccessSchema, { email: req.params.email });
    let outcome: RevokeOutcome = 'removed';
    const saved = await store.updateResident(req.params.id, (r) => {
      assertOwner(r, staff.uid);
      const result = revokeFamilyAccess(r, email, now());
      const refusal = revokeRefusal(result.outcome);
      if (refusal) throw refusal;
      outcome = result.outcome;
      return result.resident;
    });
    req.log.info({ residentId: saved.id, by: staff.uid, action: 'family_access_revoked' }, 'family access');
    return { outcome, familyAccess: saved.familyAccess ?? [] };
  });

  app.post<{ Params: { id: string } }>('/api/residents/:id/calls/import', async (req, reply) => {
    requireStaff(req);
    const input = parse(callImportSchema, req.body);
    const r = await getResidentOr404(req.params.id);
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
  const callRefusal = async (r: Resident, t: Date): Promise<HttpError | null> => {
    if (r.synthetic) return new HttpError(409, 'This is a synthetic demo resident, not a real person, so Hachi does not call them', 'synthetic');
    if (!r.active) return new HttpError(409, 'Calls are paused for this resident. Resume them first.', 'paused');
    if (!hasCallConsent(r.callConsent)) return new HttpError(409, 'The resident has not agreed to calls from Hachi yet', 'consent_required');
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
    const staff = requireStaff(req);
    if (!deps.calls) throw new HttpError(503, 'Calling from this screen is not set up on this server', 'not_configured');
    const { queue, cooldownMs } = deps.calls;
    const r = await getResidentOr404(req.params.id);
    const t = now();
    const refusal = await callRefusal(r, t);
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
    requireStaff(req);
    if (!ID.test(req.params.callId)) throw new NotFoundError('Call');
    const r = await getResidentOr404(req.params.id);
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
    requireStaff(req);
    const { includeClosed } = parse(queueQuerySchema, req.query);
    const [openCases, residents] = await Promise.all([store.listOpenCases(), store.listResidents()]);
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
    requireStaff(req);
    const t = now();
    const entries = await recentCalls(await store.listResidents(), new Date(t.getTime() - INCOMPLETE_DAYS * 86_400_000));
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
    const staff = requireStaff(req);
    if (!ID.test(req.params.callId)) throw new NotFoundError('Call');
    const r = await getResidentOr404(req.params.id);
    // The sweep only looks at residents whose calls are running.
    if (!r.active) throw new HttpError(409, 'Calls are paused for this resident, so the call cannot be analysed again until they are resumed');
    const existing = await store.getCall(r.id, req.params.callId);
    if (!existing) throw new NotFoundError('Call');
    const requestedAt = now().toISOString();
    let outcome = 'requested' as 'requested' | 'already_pending' | 'complete';
    await store.updateCall(r.id, existing.id, (c) => {
      outcome = c.analysisPending ? 'already_pending' : analysisGaps(c).length === 0 ? 'complete' : 'requested';
      return outcome === 'requested' ? { ...c, analysisPending: true, reanalysis: { requestedAt, requestedBy: staff.uid } } : null;
    });
    if (outcome === 'complete') throw new HttpError(409, 'This call was fully analysed; there is nothing to check again');
    if (outcome === 'already_pending') return reply.status(202).send({ status: 'already_pending' });
    req.log.info({ residentId: r.id, callId: existing.id, by: staff.uid }, 'reanalysis requested');
    return reply.status(202).send({ status: 'requested', requestedAt });
  });

  /**
   * This month's AI spend. Staff see it because when calls stop going out they are the ones who
   * will be asked why, and "the budget is used up" is an answer they can act on.
   */
  app.get('/api/spend', async (req) => {
    requireStaff(req);
    if (!deps.spend) return null;
    const month = spendMonth(now());
    const ledger = (await store.getSpendLedger(month)) ?? emptyLedger(month, now().toISOString());
    return buildSpendView(ledger, deps.spend.policy, localeOf(req));
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    requireStaff(req);
    const c = await store.getCase(req.params.id);
    if (!c) throw new NotFoundError('Case');
    const [r, residentCases, calls, events] = await Promise.all([
      getResidentOr404(c.residentId),
      store.listCasesByResident(c.residentId),
      store.listCalls(c.residentId, { limit: HISTORY_CALLS }),
      store.listCaseEvents(c.id),
    ]);
    return buildCaseDetail(c, r, residentCases, calls, events, signer, now(), localeOf(req));
  });

  app.patch<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    const staff = requireStaff(req);
    const update = parse(caseUpdateSchema, req.body);
    return store.mutateCase(req.params.id, (c) => applyStaffUpdate(c, update, staff.uid, now(), newId));
  });

  // ---- Family dashboard (FAM-01..04) ----

  const familyResidents = async (contacts: string[]): Promise<Resident[]> => {
    const lists = await Promise.all(contacts.map((c) => store.findResidentsByFamilyContact(c)));
    return [...new Map(lists.flat().map((r) => [r.id, r])).values()];
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
    if (!r || !r.familyLookup.some((c) => fam.contacts.includes(c))) throw new NotFoundError('Resident');
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
  const heldRequests = async (req: FastifyRequest): Promise<Map<string, Resident>> => {
    if (req.principal?.kind === 'staff') {
      return new Map((await store.listResidents()).map((r) => [r.id, r]));
    }
    const fam = requireFamily(req);
    return new Map((await familyResidents(fam.contacts)).map((r) => [r.id, r]));
  };

  app.get('/api/contact-requests', async (req) => {
    const visible = await heldRequests(req);
    return { requests: buildHeldRequests(await store.listOutboxAwaitingApproval(100), visible) };
  });

  app.post<{ Params: { id: string } }>('/api/contact-requests/:id', async (req) => {
    const { decision } = parse(contactDecisionSchema, req.body);
    const visible = await heldRequests(req);
    const entry = await store.getOutbox(req.params.id);
    // One answer for "no such request" and "not yours", so requests cannot be enumerated.
    if (!entry || entry.kind !== 'contact_request' || !visible.has(entry.residentId)) throw new NotFoundError('Contact request');
    const { outcome } = await decideContactRequest(store, entry.id, {
      by: req.principal!.kind === 'staff' ? 'staff' : 'family',
      uid: req.principal!.uid,
      at: now().toISOString(),
      decision: decision === 'approve' ? 'approved' : 'rejected',
    });
    // Approving only queues it; the notification worker's sweep is what sends it.
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
