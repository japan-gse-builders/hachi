import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { CallSession, type SessionDeps } from './session.js';

export interface GatewayAppDeps extends Omit<SessionDeps, 'log'> {
  logger?: boolean;
  /** Close sockets that never send a valid `start` event. */
  startTimeoutMs?: number;
}

export function buildApp(deps: GatewayAppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  void app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  app.get('/healthz', async () => ({ ok: true }));
  // Cloud Run's frontend reserves some paths ending in "z", so probes use /health.
  app.get('/health', async () => ({ ok: true }));

  void app.register(async (scope) => {
    scope.get('/twilio/stream', { websocket: true }, (socket, req) => {
      const session = new CallSession(
        { ...deps, log: req.log },
        {
          send: (data) => {
            if (socket.readyState === socket.OPEN) socket.send(data);
          },
          close: () => socket.close(),
        },
      );
      const timeout = setTimeout(() => {
        if (session.currentState === 'waiting') void session.finish('gateway_error');
      }, deps.startTimeoutMs ?? 10_000);
      socket.on('message', (data) => {
        session.onMessage(data.toString()).catch((err: Error) => req.log.error({ err: err.message }, 'stream message failed'));
      });
      socket.on('close', () => {
        clearTimeout(timeout);
        session.onSocketClosed().catch((err: Error) => req.log.error({ err: err.message }, 'stream close failed'));
      });
    });
  });

  return app;
}
