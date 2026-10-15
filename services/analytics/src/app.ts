import Fastify from 'fastify';
import type { TaskCallerVerifier } from '@hachi/cloud';
import { exportCalls, type ExportDeps } from './worker.js';

export function buildApp(deps: ExportDeps & { verifier: TaskCallerVerifier; logger?: boolean }) {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 1024 });
  app.get('/health', async () => ({ ok: true }));
  app.post('/tasks/export', async (request, reply) => {
    try { await deps.verifier.verify(request.headers.authorization); }
    catch { return reply.status(403).send({ error: 'Forbidden' }); }
    try {
      const result = await exportCalls(deps);
      if (result.failed) request.log.warn(result, 'analytics export will retry');
      else if (result.invalid) request.log.warn(result, 'analytics scan skipped invalid source records');
      else request.log.info(result, 'analytics export');
      return reply.status(result.failed ? 503 : 200).send(result);
    } catch {
      request.log.error('analytics source unavailable; export will retry');
      return reply.status(503).send({ error: 'Analytics export unavailable' });
    }
  });
  return app;
}
