import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openingCue } from '../src/prompt.js';
import { IDS, markMessage, setup, startMessage } from './fixtures.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function gateway(startTimeoutMs?: number) {
  const ctx = await setup();
  app = buildApp({ ...ctx.deps, startTimeoutMs });
  await app.ready();
  return ctx;
}

function closed(ws: { once(event: 'close', cb: () => void): unknown }) {
  return new Promise<void>((resolve) => ws.once('close', () => resolve()));
}

describe('voice gateway app', () => {
  it('answers health checks', async () => {
    await gateway();
    const res = await app!.inject({ url: '/healthz' });
    expect(res.json()).toEqual({ ok: true });
    expect((await app!.inject({ url: '/health' })).json()).toEqual({ ok: true });
  });

  it('bridges a Twilio media stream to Gemini and ends cleanly', async () => {
    const ctx = await gateway();
    const ws = await app!.injectWS('/twilio/stream');
    const received: any[] = [];
    ws.on('message', (d) => received.push(JSON.parse(d.toString())));
    const done = closed(ws);

    ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
    ws.send(startMessage());
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(1));
    expect(ctx.live.last.texts).toEqual([openingCue('Maggie')]);

    ctx.live.last.h.audio(new Int16Array(480).fill(5000));
    // A reason that needs no word from the resident (issue #10); the consent checks are tested in session.test.ts.
    ctx.live.last.h.toolCalls([{ id: 'f', name: 'end_call', args: { reason: 'wrong_person' } }]);
    await vi.waitFor(() => expect(received.some((m) => m.event === 'mark')).toBe(true));
    expect(received[0]).toMatchObject({ event: 'media', streamSid: 'MZ1' });

    ws.send(markMessage(received.find((m) => m.event === 'mark').mark.name));
    await done;
    await vi.waitFor(async () => expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('agent'));
  });

  it('records a resident hang-up when Twilio closes the socket', async () => {
    const ctx = await gateway();
    const ws = await app!.injectWS('/twilio/stream');
    ws.send(startMessage());
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(1));
    ws.terminate();
    await vi.waitFor(async () => expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('resident'));
  });

  it('closes sockets that never start a stream', async () => {
    const ctx = await gateway(30);
    const ws = await app!.injectWS('/twilio/stream');
    await closed(ws);
    expect(ctx.live.sessions).toHaveLength(0);
  });

  it('closes sockets with an invalid stream token', async () => {
    const ctx = await gateway();
    const ws = await app!.injectWS('/twilio/stream');
    const done = closed(ws);
    ws.send(startMessage({ streamToken: 'wrong-secret!' }));
    await done;
    expect(ctx.live.sessions).toHaveLength(0);
  });

  it('logs instead of crashing when the store fails', async () => {
    const ctx = await gateway();
    vi.spyOn(ctx.store, 'getCall').mockRejectedValue(new Error('firestore down'));
    const ws = await app!.injectWS('/twilio/stream');
    ws.send(startMessage());
    await vi.waitFor(() => expect(ctx.store.getCall).toHaveBeenCalled());
    ws.terminate();
    const res = await app!.inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
