import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { call, setup, unavailable } from './fixtures.js';

const auth = { authorization: 'Bearer good' };
const payload = { residentId: 'res-1', callId: '2026-10-02-1' };

async function app(opts: Parameters<typeof setup>[0] = {}) {
  const ctx = await setup(opts);
  const verifier = {
    verify: vi.fn(async (h: string | undefined) => {
      if (h !== 'Bearer good') throw new Error('bad token');
    }),
  };
  return { ...ctx, app: buildApp({ ...ctx.deps, verifier }) };
}

const analyze = (a: Awaited<ReturnType<typeof app>>['app'], headers: Record<string, string> = auth, body: unknown = payload) =>
  a.inject({ method: 'POST', url: '/tasks/analyze', payload: body as object, headers });

describe('analyzer app', () => {
  it('answers health checks without auth', async () => {
    const { app: a } = await app();
    expect((await a.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await a.inject({ url: '/health' })).json()).toEqual({ ok: true });
  });

  it('rejects task calls without a valid OIDC token', async () => {
    const { app: a, reviewer } = await app();
    for (const url of ['/tasks/analyze', '/tasks/sweep']) {
      const res = await a.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer bad' } });
      expect(res.statusCode).toBe(403);
    }
    expect(reviewer.inputs).toHaveLength(0);
  });

  it('analyses a call', async () => {
    const { app: a } = await app();
    const res = await analyze(a);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: 'analyzed', rules: [], model: true, incomplete: [] });
    expect((await analyze(a)).json()).toEqual({ outcome: 'done' });
  });

  it('passes the Cloud Tasks retry count so model outages fall back to the rules', async () => {
    const { app: a, reviewer } = await app();
    reviewer.next(unavailable(), unavailable());
    expect((await analyze(a)).statusCode).toBe(503);
    const res = await analyze(a, { ...auth, 'x-cloudtasks-taskretrycount': '5' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'analyzed', model: false, incomplete: [{ part: 'review', failure: 'model_unavailable' }] });
    // The provider's own message stays in the log.
    expect(res.json()).not.toHaveProperty('errors');
  });

  it('answers 503 while the call settles or another worker holds it', async () => {
    const { app: a } = await app({ calls: [call({ conversation: { endedBy: 'agent', at: '2026-10-02T02:59:50.000Z' } })] });
    expect((await analyze(a, { ...auth, 'x-cloudtasks-taskretrycount': 'x' })).statusCode).toBe(503);
    const busy = await app({ calls: [call({ analysisLease: '2099-01-01T00:00:00.000Z' })] });
    expect((await analyze(busy.app)).statusCode).toBe(503);
  });

  it('acknowledges malformed and unknown tasks', async () => {
    const { app: a } = await app();
    expect((await analyze(a, auth, { callId: 'x' })).json()).toEqual({ outcome: 'rejected' });
    expect((await analyze(a, auth, { residentId: 'res-1', callId: 'nope' })).json()).toEqual({ outcome: 'not_found' });
  });

  it('runs the sweep and reports enqueue errors', async () => {
    const { app: a, queue, advance } = await app();
    advance(3600);
    const res = await a.inject({ method: 'POST', url: '/tasks/sweep', headers: auth });
    expect(res.json()).toEqual({ queued: 1, errors: [] });
    expect((await a.inject({ method: 'POST', url: '/tasks/sweep', headers: auth })).statusCode).toBe(200);
    queue.fail = true;
    advance(3600);
    expect((await a.inject({ method: 'POST', url: '/tasks/sweep', headers: auth })).statusCode).toBe(500);
  });

  it('hides internal errors', async () => {
    const { app: a, store } = await app();
    vi.spyOn(store, 'getCall').mockRejectedValue(new Error('firestore secret detail'));
    const res = await analyze(a);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
  });
});
