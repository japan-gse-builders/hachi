import { emptyLedger, HISTORY_CALLS, PRIVACY_NOTICE, spendMonth, type Locale, type SpendSettings } from '@hachi/core';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { toPrincipal, type Principal, type TokenVerifier } from './auth.js';
import { applyStaffUpdate } from './caseUpdate.js';
import { decideContactRequest, NotFoundError, type Resident, type Store } from '@hachi/store';
import { buildHeldRequests } from './contactRequests.js';
import { addPushToken, buildImportedCalls, buildResident, patchResident } from './residents.js';
import { callImportSchema, caseUpdateSchema, contactDecisionSchema, pushTokenSchema, residentInputSchema, residentPatchSchema } from './schemas.js';
import {
  analysisGaps,
  buildCaseDetail,
  buildFamilyDashboard,
  buildIncompleteAnalyses,
  buildQueue,
  buildSpendView,
  buildUnreached,
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
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
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
      reply.header('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
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
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
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
    const resident = buildResident(input, newId(), now(), staff.uid);
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
    return store.updateResident(req.params.id, (r) => patchResident(r, patch, now(), staff.uid));
  });

  app.post<{ Params: { id: string } }>('/api/residents/:id/calls/import', async (req, reply) => {
    requireStaff(req);
    const input = parse(callImportSchema, req.body);
    const r = await getResidentOr404(req.params.id);
    const calls = buildImportedCalls(r, input, newId, now());
    await store.addCalls(calls);
    return reply.status(201).send({ imported: calls.length, usableForBaseline: calls.filter((c) => c.speech?.usable).length });
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
    const [cases, residents] = await Promise.all([store.listOpenCases(), store.listResidents()]);
    const locale = localeOf(req);
    const t = now();
    // One read covers both lists: the unreached lookback is the longer window.
    const entries = await recentCalls(residents, new Date(t.getTime() - Math.max(UNREACHED_LOOKBACK_DAYS, INCOMPLETE_DAYS) * 86_400_000));
    return {
      items: buildQueue(cases, new Map(residents.map((r) => [r.id, r])), t, locale),
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
   * second pass costs a model request and finds nothing new.
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
    let refusal: string | null = null;
    await store.updateCall(r.id, existing.id, (c) => {
      refusal = c.analysisPending
        ? 'This call is already waiting to be analysed'
        : analysisGaps(c).length === 0
          ? 'This call was fully analysed; there is nothing to check again'
          : null;
      return refusal ? null : { ...c, analysisPending: true, reanalysis: { requestedAt, requestedBy: staff.uid } };
    });
    if (refusal) throw new HttpError(409, refusal);
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
    return buildFamilyDashboard(r, calls, cases, t, localeOf(req));
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
    const residents = await familyResidents(fam.contacts);
    await Promise.all(residents.map((r) => store.updateResident(r.id, (cur) => addPushToken(cur, token))));
    return reply.status(204).send();
  });

  return app;
}
