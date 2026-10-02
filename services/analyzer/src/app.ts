import { ANALYZE_CALL_PATH, type TaskCallerVerifier } from '@hachi/cloud';
import Fastify, { type FastifyInstance } from 'fastify';
import { analyzeCall, parseAnalyzeInput, sweep, type WorkerDeps } from './worker.js';

export interface AnalyzerAppDeps extends WorkerDeps {
  verifier: TaskCallerVerifier;
  logger?: boolean;
}

function retryCount(header: string | string[] | undefined): number {
  const n = Number(Array.isArray(header) ? header[0] : header);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function buildApp(deps: AnalyzerAppDeps): FastifyInstance {
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

  app.post(ANALYZE_CALL_PATH, async (req, reply) => {
    const ref = parseAnalyzeInput(req.body);
    // A malformed task will never succeed; acknowledge it so Cloud Tasks stops retrying.
    if (!ref) {
      req.log.error('invalid analyze task');
      return reply.status(200).send({ outcome: 'rejected' });
    }
    const result = await analyzeCall(deps, ref, retryCount(req.headers['x-cloudtasks-taskretrycount']));
    // Transcripts are personal data; logs carry ids and outcomes only.
    const log = { ...ref, outcome: result.outcome, ...(result.outcome === 'analyzed' ? { rules: result.rules, model: result.model } : {}) };
    if (result.outcome === 'retry') req.log.warn({ ...log, reason: result.reason.slice(0, 200) }, 'analysis deferred');
    else if (result.outcome === 'analyzed' && !result.model) req.log.warn(log, 'analysed without the model');
    else req.log.info(log, 'analysis');
    return reply.status(result.outcome === 'retry' || result.outcome === 'busy' ? 503 : 200).send(result);
  });

  app.post('/tasks/sweep', async (req, reply) => {
    const result = await sweep(deps);
    if (result.errors.length) req.log.error(result, 'sweep could not queue some calls');
    else if (result.queued) req.log.warn(result, 'sweep queued calls for analysis');
    return reply.status(result.errors.length ? 500 : 200).send(result);
  });

  return app;
}
