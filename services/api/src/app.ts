import type { Locale } from '@hachi/core';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { toPrincipal, type Principal, type TokenVerifier } from './auth.js';
import { applyStaffUpdate } from './caseUpdate.js';
import { NotFoundError, type Resident, type Store } from '@hachi/store';
import { addPushToken, buildImportedCalls, buildResident, patchResident } from './residents.js';
import { callImportSchema, caseUpdateSchema, pushTokenSchema, residentInputSchema, residentPatchSchema } from './schemas.js';
import { buildCaseDetail, buildFamilyDashboard, buildQueue, FAMILY_WINDOW_DAYS, type MediaSigner } from './views.js';

export interface AppDeps {
  store: Store;
  verifier: TokenVerifier;
  signer: MediaSigner;
  now?: () => Date;
  newId?: () => string;
  logger?: boolean;
  /** Browser origins allowed to call this API. Empty means same-origin only. */
  corsOrigins?: string[];
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

  // ---- Staff: residents (USR-01..04) ----

  app.post('/api/residents', async (req, reply) => {
    requireStaff(req);
    const input = parse(residentInputSchema, req.body);
    const resident = buildResident(input, newId(), now());
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
    requireStaff(req);
    const patch = parse(residentPatchSchema, req.body);
    return store.updateResident(req.params.id, (r) => patchResident(r, patch, now()));
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

  app.get('/api/queue', async (req) => {
    requireStaff(req);
    const [cases, residents] = await Promise.all([store.listOpenCases(), store.listResidents()]);
    return { items: buildQueue(cases, new Map(residents.map((r) => [r.id, r])), now(), localeOf(req)) };
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    requireStaff(req);
    const c = await store.getCase(req.params.id);
    if (!c) throw new NotFoundError('Case');
    const [r, residentCases, calls, events] = await Promise.all([
      getResidentOr404(c.residentId),
      store.listCasesByResident(c.residentId),
      store.listCalls(c.residentId, { limit: 60 }),
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

  app.post('/api/family/push-tokens', async (req, reply) => {
    const fam = requireFamily(req);
    const { token } = parse(pushTokenSchema, req.body);
    const residents = await familyResidents(fam.contacts);
    await Promise.all(residents.map((r) => store.updateResident(r.id, (cur) => addPushToken(cur, token))));
    return reply.status(204).send();
  });

  return app;
}
