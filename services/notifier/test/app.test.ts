import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { entry, permanent, retryable, setup } from './fixtures.js';

const e = entry();
const auth = { authorization: 'Bearer good' };

async function app(prepare?: (ctx: Awaited<ReturnType<typeof setup>>) => void) {
  const ctx = await setup();
  prepare?.(ctx);
  const verifier = {
    verify: vi.fn(async (h: string | undefined) => {
      if (h !== 'Bearer good') throw new Error('bad token');
    }),
  };
  return { ...ctx, app: buildApp({ ...ctx.deps, verifier }) };
}

describe('notifier app', () => {
  it('answers health checks without auth', async () => {
    const { app: a } = await app();
    expect((await a.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await a.inject({ url: '/health' })).json()).toEqual({ ok: true });
  });

  it('rejects task calls without a valid OIDC token', async () => {
    const { app: a, sms } = await app();
    for (const url of ['/tasks/send', '/tasks/sweep']) {
      const res = await a.inject({ method: 'POST', url, payload: { outboxId: e.id }, headers: { authorization: 'Bearer bad' } });
      expect(res.statusCode).toBe(403);
    }
    expect(sms.sent).toHaveLength(0);
  });

  it('sends a notification', async () => {
    const { app: a, sms } = await app();
    const res = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: e.id }, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: 'sent', providerId: 'P1' });
    expect(sms.sent).toHaveLength(1);
  });

  it('answers 503 so Cloud Tasks retries temporary failures', async () => {
    const { app: a } = await app(({ sms }) => sms.failWith(retryable()));
    const res = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: e.id }, headers: auth });
    expect(res.statusCode).toBe(503);
  });

  it('acknowledges permanent failures, skips and malformed tasks', async () => {
    const { app: a } = await app(({ sms }) => sms.failWith(permanent()));
    const failed = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: e.id }, headers: auth });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().outcome).toBe('failed');
    const bad = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: 'x' }, headers: auth });
    expect(bad.json()).toEqual({ outcome: 'rejected' });
    const unknown = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: 'a'.repeat(64) }, headers: auth });
    expect(unknown.json()).toEqual({ outcome: 'not_found' });
  });

  it('logs skipped deliveries and returns 200', async () => {
    const { app: a } = await app(({ deps }) => {
      deps.senders = {};
    });
    const res = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: e.id }, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe('skipped');
  });

  it('runs the sweep', async () => {
    const { app: a, queue, advance } = await app();
    advance(300);
    const res = await a.inject({ method: 'POST', url: '/tasks/sweep', headers: auth });
    expect(res.json()).toEqual({ queued: 1, errors: [] });
    expect(queue.tasks).toHaveLength(1);
    expect((await a.inject({ method: 'POST', url: '/tasks/sweep', headers: auth })).statusCode).toBe(200);
  });

  it('reports sweep errors with 500', async () => {
    const { app: a, queue, advance } = await app();
    queue.fail = true;
    advance(300);
    expect((await a.inject({ method: 'POST', url: '/tasks/sweep', headers: auth })).statusCode).toBe(500);
  });

  it('hides internal errors', async () => {
    const { app: a, store } = await app();
    vi.spyOn(store, 'updateOutbox').mockRejectedValue(new Error('firestore secret detail'));
    const res = await a.inject({ method: 'POST', url: '/tasks/send', payload: { outboxId: e.id }, headers: auth });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
  });
});
