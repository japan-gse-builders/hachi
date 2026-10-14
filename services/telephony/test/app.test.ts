import { notificationKey } from '@hachi/core';
import { outboxId, type OutboxEntry } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { computeTwilioSignature } from '../src/twilio.js';
import { AUTH_TOKEN, BASE_URL, FakeVerifier, makeDeps, NOW, resident, retryable } from './fixtures.js';

function setup() {
  const ctx = makeDeps();
  const app = buildApp({ ...ctx.deps, verifier: new FakeVerifier(), twilioAuthToken: AUTH_TOKEN });
  return { ...ctx, app };
}

const auth = { authorization: 'Bearer good' };
const INPUT = { residentId: 'res-1', localDate: '2026-10-02', attempt: 0 };

function twilioPost(path: string, params: Record<string, string>, signWith = AUTH_TOKEN) {
  return {
    method: 'POST' as const,
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': computeTwilioSignature(signWith, `${BASE_URL}${path}`, params),
    },
    payload: new URLSearchParams(params).toString(),
  };
}

describe('telephony routes', () => {
  it('serves a health check without auth', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });

  it('requires a trusted Google OIDC caller for task endpoints', async () => {
    const { app, telephony } = setup();
    for (const url of ['/tasks/dispatch', '/tasks/place-call']) {
      expect((await app.inject({ method: 'POST', url, payload: INPUT })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url, payload: INPUT, headers: { authorization: 'Bearer bad' } })).statusCode).toBe(403);
    }
    expect(telephony.calls).toHaveLength(0);
  });

  it('dispatches due calls, returning 500 when some could not be queued', async () => {
    const { app, store, queue } = setup();
    await store.createResident(resident('res-1'));
    const ok = await app.inject({ method: 'POST', url: '/tasks/dispatch', headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ enqueued: 1 });
    await store.createResident(resident('res-2'));
    queue.failFor.add('res-2');
    expect((await app.inject({ method: 'POST', url: '/tasks/dispatch', headers: auth })).statusCode).toBe(500);
  });

  it('places a call from a task', async () => {
    const { app, store } = setup();
    await store.createResident(resident('res-1'));
    const res = await app.inject({ method: 'POST', url: '/tasks/place-call', headers: auth, payload: INPUT });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe('placed');
  });

  it('acknowledges malformed tasks so they are not retried forever', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/tasks/place-call', headers: auth, payload: { residentId: 'x' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: 'rejected' });
  });

  it('returns 503 for temporary failures and passes the Cloud Tasks retry count through', async () => {
    const { app, store, telephony } = setup();
    await store.createResident(resident('res-1'));
    telephony.failWith(retryable());
    const first = await app.inject({ method: 'POST', url: '/tasks/place-call', headers: auth, payload: INPUT });
    expect(first.statusCode).toBe(503);
    const last = await app.inject({
      method: 'POST',
      url: '/tasks/place-call',
      headers: { ...auth, 'x-cloudtasks-taskretrycount': '3' },
      payload: INPUT,
    });
    expect(last.statusCode).toBe(200);
    expect(last.json()).toEqual({ outcome: 'failed', retryScheduled: true });
  });

  it('accepts signed Twilio status callbacks and rejects unsigned ones', async () => {
    const { app, store } = setup();
    await store.createResident(resident('res-1'));
    const placed = (await app.inject({ method: 'POST', url: '/tasks/place-call', headers: auth, payload: INPUT })).json();
    const path = '/twilio/status?residentId=res-1&callId=2026-10-02-0';
    const params = { CallSid: placed.providerCallId, CallStatus: 'completed', CallDuration: '200' };

    expect((await app.inject(twilioPost(path, params, 'wrong-token'))).statusCode).toBe(403);
    expect((await app.inject({ ...twilioPost(path, params), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(403);
    expect((await store.getCall('res-1', '2026-10-02-0'))!.status).toBe('scheduled');

    expect((await app.inject(twilioPost(path, params))).statusCode).toBe(204);
    expect(await store.getCall('res-1', '2026-10-02-0')).toMatchObject({ status: 'completed', durationSec: 200 });
  });

  it('validates callback identifiers', async () => {
    const { app } = setup();
    expect((await app.inject(twilioPost('/twilio/status?residentId=res-1', { CallStatus: 'completed' }))).statusCode).toBe(400);
    expect((await app.inject(twilioPost('/twilio/status?residentId=res-1&callId=nope', { CallStatus: 'completed' }))).statusCode).toBe(404);
  });

  it('hides internal errors', async () => {
    const { app, store } = setup();
    store.listActiveResidents = async () => Promise.reject(new Error('firestore exploded'));
    const res = await app.inject({ method: 'POST', url: '/tasks/dispatch', headers: auth });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });
  });

  it('passes through client errors from the framework', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/tasks/place-call', headers: { ...auth, 'content-type': 'application/json' }, payload: '{bad json' });
    expect(res.statusCode).toBe(400);
  });
});

describe('notification delivery reports', () => {
  const SID = 'SM0123456789abcdef0123456789abcdef';

  async function withSentSms() {
    const ctx = setup();
    const key = notificationKey('case-1', 'emergency', 'family', 'sms', '+819000000002');
    const e: OutboxEntry = {
      id: outboxId(key),
      idempotencyKey: key,
      caseId: 'case-1',
      orgId: 'org-1',
      residentId: 'res-1',
      urgency: 'emergency',
      recipient: 'family',
      channel: 'sms',
      address: '+819000000002',
      subject: 's',
      body: 'b',
      priority: 'immediate',
      status: 'sent',
      attempts: 1,
      createdAt: NOW.toISOString(),
      sentAt: NOW.toISOString(),
      providerId: SID,
    };
    await ctx.store.enqueueOutbox([e]);
    return { ...ctx, e, path: `/twilio/delivery-status?outboxId=${e.id}` };
  }

  it('records a signed report and ignores a late "sent" after "undelivered"', async () => {
    const { app, store, e, path } = await withSentSms();
    const undelivered = { MessageSid: SID, MessageStatus: 'undelivered', ErrorCode: '30007', To: '+819000000002' };
    expect((await app.inject(twilioPost(path, undelivered))).statusCode).toBe(204);
    expect((await app.inject(twilioPost(path, { MessageSid: SID, MessageStatus: 'sent' }))).statusCode).toBe(204);
    expect((await store.getOutbox(e.id))!.delivery).toEqual({ status: 'undelivered', errorCode: '30007', at: NOW.toISOString() });
  });

  it('records the outcome of a voice alert call', async () => {
    const { app, store, e } = await withSentSms();
    const CA = 'CA0123456789abcdef0123456789abcdef';
    await store.updateOutbox(e.id, (x) => ({ ...x, channel: 'voice', providerId: CA }));
    const res = await app.inject(twilioPost(`/twilio/delivery-status?outboxId=${e.id}`, { CallSid: CA, CallStatus: 'no-answer' }));
    expect(res.statusCode).toBe(204);
    expect((await store.getOutbox(e.id))!.delivery?.status).toBe('no_answer');
  });

  it('rejects unsigned, re-targeted and malformed reports', async () => {
    const { app, store, e, path } = await withSentSms();
    const params = { MessageSid: SID, MessageStatus: 'delivered' };
    expect((await app.inject(twilioPost(path, params, 'wrong-token'))).statusCode).toBe(403);
    // A signature for one entry cannot be replayed against another.
    const other = `/twilio/delivery-status?outboxId=${'b'.repeat(64)}`;
    expect((await app.inject({ ...twilioPost(path, params), url: other })).statusCode).toBe(403);
    expect((await app.inject(twilioPost('/twilio/delivery-status?outboxId=nope', params))).statusCode).toBe(400);
    expect((await app.inject(twilioPost(path, { MessageSid: SID, MessageStatus: 'mystery' }))).statusCode).toBe(400);
    expect((await store.getOutbox(e.id))!.delivery).toBeUndefined();
  });
});

describe('emergency routes', () => {
  const IDS = { residentId: 'res-1', callId: '2026-10-02-0' };
  const qs = 'residentId=res-1&callId=2026-10-02-0';

  async function withEmergency() {
    const ctx = setup();
    await ctx.store.createResident(resident('res-1', { family: { name: 'Alice', sms: '+819000000002' } }));
    await ctx.store.createCallIfAbsent({
      id: IDS.callId,
      residentId: 'res-1',
      source: 'live',
      status: 'in_progress',
      channel: 'pstn',
      startedAt: '2026-10-02T01:00:00.000Z',
      analysisPending: false,
      createdAt: '2026-10-02T01:00:00.000Z',
      emergency: { at: '2026-10-02T01:02:00.000Z', caseId: 'case-1', quote: 'help' },
    });
    return ctx;
  }

  it('runs the emergency transfer task for trusted callers only', async () => {
    const { app, telephony } = await withEmergency();
    expect((await app.inject({ method: 'POST', url: '/tasks/emergency-transfer', payload: IDS })).statusCode).toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/tasks/emergency-transfer', headers: auth, payload: { residentId: '../x' } });
    expect(bad.json()).toEqual({ outcome: 'rejected' });
    const ok = await app.inject({ method: 'POST', url: '/tasks/emergency-transfer', headers: auth, payload: IDS });
    expect(ok.statusCode).toBe(200);
    expect(telephony.calls).toHaveLength(2);
  });

  it('asks Cloud Tasks to retry when a leg fails temporarily', async () => {
    const { app, telephony } = await withEmergency();
    telephony.failWith(retryable());
    expect((await app.inject({ method: 'POST', url: '/tasks/emergency-transfer', headers: auth, payload: IDS })).statusCode).toBe(503);
  });

  it('serves signed TwiML for after-stream, alert responses and hold', async () => {
    const { app } = await withEmergency();
    const after = await app.inject(twilioPost(`/twilio/after-stream?${qs}`, { CallSid: 'CA1' }));
    expect(after.headers['content-type']).toContain('text/xml');
    expect(after.body).toContain('<Conference');
    expect((await app.inject(twilioPost('/twilio/after-stream', {}))).body).toBe('<Response><Hangup/></Response>');

    const join = await app.inject(twilioPost(`/twilio/alert-response?${qs}`, { Digits: '1' }));
    expect(join.body).toContain('Connecting you to Margaret Smith now.');
    expect((await app.inject(twilioPost('/twilio/alert-response', { Digits: '1' }))).body).toBe('<Response><Hangup/></Response>');

    expect((await app.inject(twilioPost('/twilio/hold', {}))).body).toContain('<Pause');
  });

  it('rejects unsigned TwiML requests', async () => {
    const { app } = await withEmergency();
    for (const path of [`/twilio/after-stream?${qs}`, `/twilio/alert-response?${qs}`, '/twilio/hold']) {
      expect((await app.inject(twilioPost(path, {}, 'wrong'))).statusCode).toBe(403);
    }
  });
});
