import type { TaskCallerVerifier } from '@hachi/cloud';
import { NotFoundError } from '@hachi/store';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterStream, alertResponse, EMERGENCY_TRANSFER_PATH, emergencyTransfer, holdTwiml, type CallIds } from './bridge.js';
import { applyCallStatus, dispatchDueCalls, parsePlaceCallInput, placeCall, PLACE_CALL_PATH, type CallDeps } from './calls.js';
import { isValidTwilioSignature } from './twilio.js';

export interface TelephonyAppDeps extends CallDeps {
  verifier: TaskCallerVerifier;
  twilioAuthToken: string;
  logger?: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function parseIds(v: unknown): CallIds | null {
  const o = v as Partial<CallIds> | null;
  return o && typeof o.residentId === 'string' && ID.test(o.residentId) && typeof o.callId === 'string' && ID.test(o.callId)
    ? { residentId: o.residentId, callId: o.callId }
    : null;
}

export function buildApp(deps: TelephonyAppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 64 * 1024 });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  const requireTaskCaller = async (authorization: string | undefined) => {
    try {
      await deps.verifier.verify(authorization);
      return true;
    } catch {
      return false;
    }
  };

  /** Rejects requests that are not signed by Twilio for exactly this URL and body. */
  const twilioParams = (req: FastifyRequest, reply: FastifyReply): Record<string, string> | null => {
    const params = (req.body ?? {}) as Record<string, string>;
    const signature = req.headers['x-twilio-signature'];
    const url = `${deps.config.publicBaseUrl}${req.url}`;
    if (!isValidTwilioSignature(deps.twilioAuthToken, url, params, typeof signature === 'string' ? signature : undefined)) {
      void reply.status(403).send({ error: 'Invalid signature' });
      return null;
    }
    return params;
  };

  const twiml = (reply: FastifyReply, xml: string) => reply.type('text/xml').send(xml);

  app.get('/healthz', async () => ({ ok: true }));
  // Cloud Run's frontend reserves some paths ending in "z", so probes use /health.
  app.get('/health', async () => ({ ok: true }));

  app.post('/tasks/dispatch', async (req, reply) => {
    if (!(await requireTaskCaller(req.headers.authorization))) return reply.status(403).send({ error: 'Forbidden' });
    const result = await dispatchDueCalls(deps);
    if (result.errors.length) req.log.error({ errors: result.errors }, 'dispatch had errors');
    return reply.status(result.errors.length ? 500 : 200).send(result);
  });

  app.post(PLACE_CALL_PATH, async (req, reply) => {
    if (!(await requireTaskCaller(req.headers.authorization))) return reply.status(403).send({ error: 'Forbidden' });
    const input = parsePlaceCallInput(req.body, deps.config.maxAttempts);
    // A malformed task will never succeed; acknowledge it so Cloud Tasks stops retrying.
    if (!input) {
      req.log.error({ body: req.body }, 'invalid place-call task');
      return reply.status(200).send({ outcome: 'rejected' });
    }
    const retryCount = Number(req.headers['x-cloudtasks-taskretrycount'] ?? 0) || 0;
    const result = await placeCall(deps, input, retryCount);
    if (result.outcome === 'failed') req.log.error({ input, result }, 'call attempt failed');
    return reply.status(result.outcome === 'retry_later' ? 503 : 200).send(result);
  });

  app.post(EMERGENCY_TRANSFER_PATH, async (req, reply) => {
    if (!(await requireTaskCaller(req.headers.authorization))) return reply.status(403).send({ error: 'Forbidden' });
    const ids = parseIds(req.body);
    if (!ids) {
      req.log.error({ body: req.body }, 'invalid emergency-transfer task');
      return reply.status(200).send({ outcome: 'rejected' });
    }
    const result = await emergencyTransfer(deps, ids);
    req.log.warn({ ...ids, result }, 'emergency transfer');
    return reply.status(result.outcome === 'retry_later' ? 503 : 200).send(result);
  });

  app.post('/twilio/status', async (req, reply) => {
    const params = twilioParams(req, reply);
    if (!params) return reply;
    const ids = parseIds(req.query);
    if (!ids) return reply.status(400).send({ error: 'residentId and callId are required' });
    const result = await applyCallStatus(deps, ids, params);
    req.log.info({ ...ids, twilioStatus: params.CallStatus, ...result }, 'call status');
    return reply.status(204).send();
  });

  app.post('/twilio/after-stream', async (req, reply) => {
    if (!twilioParams(req, reply)) return reply;
    const ids = parseIds(req.query);
    if (!ids) return twiml(reply, '<Response><Hangup/></Response>');
    return twiml(reply, await afterStream(deps, ids));
  });

  app.post('/twilio/alert-response', async (req, reply) => {
    const params = twilioParams(req, reply);
    if (!params) return reply;
    const ids = parseIds(req.query);
    if (!ids) return twiml(reply, '<Response><Hangup/></Response>');
    req.log.warn({ ...ids, digits: params.Digits }, 'emergency alert answered');
    return twiml(reply, await alertResponse(deps, ids, params.Digits));
  });

  app.post('/twilio/hold', async (req, reply) => {
    if (!twilioParams(req, reply)) return reply;
    return twiml(reply, holdTwiml(deps));
  });

  return app;
}
