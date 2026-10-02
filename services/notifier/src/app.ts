import { SEND_NOTIFICATION_PATH, type TaskCallerVerifier } from '@hachi/cloud';
import Fastify, { type FastifyInstance } from 'fastify';
import { deliver, parseSendInput, sweep, type WorkerDeps } from './worker.js';

export interface NotifierAppDeps extends WorkerDeps {
  verifier: TaskCallerVerifier;
  logger?: boolean;
}

export function buildApp(deps: NotifierAppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 16 * 1024 });

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/tasks/')) return;
    try {
      await deps.verifier.verify(req.headers.authorization);
    } catch {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  app.get('/healthz', async () => ({ ok: true }));
  // Cloud Run's frontend reserves some paths ending in "z", so probes use /health.
  app.get('/health', async () => ({ ok: true }));

  app.post(SEND_NOTIFICATION_PATH, async (req, reply) => {
    const id = parseSendInput(req.body);
    // A malformed task will never succeed; acknowledge it so Cloud Tasks stops retrying.
    if (!id) {
      req.log.error({ body: req.body }, 'invalid send task');
      return reply.status(200).send({ outcome: 'rejected' });
    }
    const result = await deliver(deps, id);
    // Addresses are personal data; logs carry the entry id only.
    const log = { outboxId: id, ...result };
    if (result.outcome === 'failed') req.log.error(log, 'notification failed permanently');
    else if (result.outcome === 'retry' || result.outcome === 'skipped') req.log.warn(log, 'notification not sent');
    else req.log.info(log, 'notification');
    return reply.status(result.outcome === 'retry' || result.outcome === 'busy' ? 503 : 200).send(result);
  });

  app.post('/tasks/sweep', async (req, reply) => {
    const result = await sweep(deps);
    if (result.errors.length) req.log.error(result, 'sweep could not queue some notifications');
    else if (result.queued) req.log.warn(result, 'sweep re-queued notifications');
    return reply.status(result.errors.length ? 500 : 200).send(result);
  });

  return app;
}
