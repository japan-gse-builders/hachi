import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '@hachi/store';
import { call, detection, fakeSigner, FakeVerifier, makeResident, NOW, residentInput, setup, storedCase } from './helpers.js';

describe('health and authentication', () => {
  it('serves /healthz and /health without a token', async () => {
    const { app } = setup();
    for (const url of ['/healthz', '/health']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    }
  });

  it('allows the configured browser origin and answers its preflight', async () => {
    const store = new MemoryStore();
    const app = buildApp({
      store,
      verifier: new FakeVerifier(),
      signer: fakeSigner,
      corsOrigins: ['http://localhost:5173'],
    });
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/queue',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects missing and invalid tokens with 401', async () => {
    const { app, as } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as(null) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/residents', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/residents', headers: { authorization: 'Basic abc' } })).statusCode).toBe(401);
  });

  it('rejects users without a verified contact (FAM-01)', async () => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/family/residents', ...as('unverifiedEmail') });
    expect(res.statusCode).toBe(403);
  });

  it('keeps staff and family routes apart', async () => {
    const { app, as } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/queue', ...as('familyPhone') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/family/residents', ...as('staff') })).statusCode).toBe(403);
  });

  it('sets no-store and nosniff headers', async () => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/residents', ...as('staff') });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('hides internal error details', async () => {
    const store = new MemoryStore();
    store.listResidents = async () => {
      throw new Error('secret database detail');
    };
    const app = buildApp({ store, verifier: new FakeVerifier(), signer: fakeSigner });
    const res = await app.inject({ method: 'GET', url: '/api/residents', headers: { authorization: 'Bearer staff' } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
  });

  it('returns 4xx for malformed JSON bodies', async () => {
    const { app, as } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/residents',
      headers: { ...as('staff').headers, 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('residents (USR-01..03)', () => {
  it('registers a resident with normalized contacts', async () => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput() });
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r).toMatchObject({
      id: 'id-1',
      channel: 'pstn',
      active: true,
      serviceStartedAt: NOW.toISOString(),
      familyLookup: ['+819000000002', 'alice@example.org'],
    });
    expect(r.family.voice).toBe('+819000000002');
    expect(r.staff.voice).toBe('+81300000000');
  });

  it.each([
    ['phone without a country code', { phone: '90-1234-5678' }, 'phone'],
    ['bad call time', { callTime: '25:00' }, 'callTime'],
    ['unknown time zone', { timeZone: 'Mars/Base' }, 'timeZone'],
    ['staff without sms or email', { staff: { name: 'T', phone: '+81300000000' } }, 'staff.sms'],
    ['family without sms or email', { family: { name: 'A' } }, 'family.sms'],
    ['missing name', { name: '' }, 'name'],
  ])('rejects %s', async (_label, overrides, path) => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput(overrides) });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toContain(path);
  });

  it('lists, reads and patches residents', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1', { channel: 'whatsapp' }));
    expect((await app.inject({ method: 'GET', url: '/api/residents', ...as('staff') })).json().residents).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/residents/res-1', ...as('staff') })).json().name).toBe('Margaret Smith');
    expect((await app.inject({ method: 'GET', url: '/api/residents/nope', ...as('staff') })).statusCode).toBe(404);

    const patched = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callTime: '09:30' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ callTime: '09:30', channel: 'whatsapp' });

    const removed = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { family: null } });
    expect(removed.json().family).toBeUndefined();
    expect(removed.json().familyLookup).toEqual([]);

    expect((await app.inject({ method: 'PATCH', url: '/api/residents/nope', ...as('staff'), payload: {} })).statusCode).toBe(404);
  });
});

describe('call import (USR-04)', () => {
  const transcript = [
    { speaker: 'agent', text: 'Good morning', startMs: 0, endMs: 1000 },
    { speaker: 'resident', text: Array.from({ length: 80 }, (_, i) => `word${i % 30}`).join(' '), startMs: 1800, endMs: 30000 },
  ];

  it('imports calls with speech features for the baseline', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/residents/res-1/calls/import',
      ...as('staff'),
      payload: {
        calls: [
          { startedAt: '2026-09-01T01:00:00.000Z', endedAt: '2026-09-01T01:04:00.000Z', transcript },
          {
            startedAt: '2026-09-02T01:00:00.000Z',
            endedAt: '2026-09-02T01:01:00.000Z',
            transcript: [{ speaker: 'resident', text: 'fine', startMs: 0, endMs: 10 }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ imported: 2, usableForBaseline: 1 });
    const calls = await store.listCalls('res-1');
    expect(calls[1]).toMatchObject({ source: 'imported', durationSec: 240, analysisPending: true });
    expect(calls[1]!.speech?.features.responseLatencyMs).toBe(800);
  });

  it('validates the import payload and the resident', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    const bad = await app.inject({
      method: 'POST',
      url: '/api/residents/res-1/calls/import',
      ...as('staff'),
      payload: { calls: [{ startedAt: '2026-09-02T01:00:00.000Z', endedAt: '2026-09-01T01:00:00.000Z', transcript }] },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/residents/nope/calls/import',
      ...as('staff'),
      payload: { calls: [{ startedAt: '2026-09-01T01:00:00.000Z', endedAt: '2026-09-01T01:04:00.000Z', transcript }] },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('triage queue and cases (QUE-01..03)', () => {
  async function seeded() {
    const ctx = setup();
    await ctx.store.createResident(makeResident('res-1'));
    await ctx.store.createResident(makeResident('res-2', { name: 'Bob Brown', vulnerability: { livesAlone: false, hasCloseSupporter: true, needsCare: false, chronicConditions: [] } }));
    await ctx.store.addCalls([call()]);
    await ctx.store.putCase(storedCase({ id: 'watch', residentId: 'res-2' }));
    await ctx.store.putCase(
      storedCase({
        id: 'emergency',
        rule: 'R1',
        autoUrgency: 'emergency',
        detections: [detection({ rule: 'R1', urgency: 'emergency', summary: 'Chest pain since morning' })],
        notifications: [
          {
            recipient: 'family',
            channel: 'sms',
            address: '+819000000002',
            sentAt: '2026-10-01T01:06:00.000Z',
            delivery: { status: 'delivered', at: '2026-10-01T01:06:05.000Z' },
          },
        ],
      }),
    );
    await ctx.store.putCase(storedCase({ id: 'closed', status: 'closed' }));
    return ctx;
  }

  it('lists open cases with emergency first and reasons (QUE-01)', async () => {
    const { app, as } = await seeded();
    const res = await app.inject({ method: 'GET', url: '/api/queue', ...as('staff') });
    const items = res.json().items;
    expect(items.map((i: { caseId: string }) => i.caseId)).toEqual(['emergency', 'watch']);
    expect(items[0]).toMatchObject({ residentName: 'Margaret Smith', urgencyLabel: '緊急', summary: 'Chest pain since morning', status: 'open' });
    expect(items[0].reason).toContain('体調の急な異変を訴えている');
    expect(items[0].notifications).toHaveLength(1);
    expect(items[0].notifications[0].delivery).toEqual({ status: 'delivered', at: '2026-10-01T01:06:05.000Z' });
    const en = await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') });
    expect(en.json().items[0].urgencyLabel).toBe('Emergency');
  });

  it('skips cases whose resident no longer exists', async () => {
    const { app, as, store } = await seeded();
    await store.putCase(storedCase({ id: 'orphan', residentId: 'gone' }));
    const items = (await app.inject({ method: 'GET', url: '/api/queue', ...as('staff') })).json().items;
    expect(items.map((i: { caseId: string }) => i.caseId)).not.toContain('orphan');
  });

  it('applies the staff rank adjustment to the queue order', async () => {
    const { app, as, store } = await seeded();
    await store.putCase(storedCase({ id: 'watch-boosted', residentId: 'res-2', rule: 'R3', staffScoreOffset: 10 }));
    const items = (await app.inject({ method: 'GET', url: '/api/queue', ...as('staff') })).json().items;
    expect(items.map((i: { caseId: string }) => i.caseId)).toEqual(['emergency', 'watch-boosted', 'watch']);
  });

  it('shows case details with evidence audio and transcript (QUE-02)', async () => {
    const { app, as, store } = await seeded();
    await store.addCalls([call({ id: 'call-0', startedAt: '2026-09-30T01:00:00.000Z', audioUri: undefined })]);
    const res = await app.inject({ method: 'GET', url: '/api/cases/emergency', ...as('staff') });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.case).toMatchObject({ id: 'emergency', ruleName: '急な体調の異変', urgency: 'emergency', staffUrgency: null, staffScoreOffset: 0 });
    expect(d.detections[0].evidence[0].audioUrl).toBe('https://signed.example/gs%3A%2F%2Fhachi-audio%2Fres-1%2Fcall-1.wav');
    expect(d.calls.find((c: { id: string }) => c.id === 'call-1').transcript).toHaveLength(2);
    expect(d.calls.find((c: { id: string }) => c.id === 'call-0').transcript).toBeUndefined();
    expect(d.resident.householdNotes).toBeNull();
  });

  it('shows details for closed cases and returns 404 for unknown ones', async () => {
    const { app, as } = await seeded();
    expect((await app.inject({ method: 'GET', url: '/api/cases/closed', ...as('staff') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/cases/nope', ...as('staff') })).statusCode).toBe(404);
  });

  it('includes the speech trend oldest first', async () => {
    const { app, as, store } = await seeded();
    const speech = (id: string, usable: boolean) => ({
      callId: id,
      at: '',
      usable,
      exclusionReasons: [],
      features: { lexicalDiversity: 0.7, repairRate: 1, responseLatencyMs: 900, topicCoherence: null },
    });
    await store.addCalls([
      call({ id: 's1', startedAt: '2026-09-28T01:00:00.000Z', speech: speech('s1', true) }),
      call({ id: 's2', startedAt: '2026-09-29T01:00:00.000Z', speech: speech('s2', true) }),
      call({ id: 's3', startedAt: '2026-09-30T01:00:00.000Z', speech: speech('s3', false) }),
    ]);
    const d = (await app.inject({ method: 'GET', url: '/api/cases/emergency', ...as('staff') })).json();
    expect(d.speechTrend.map((p: { callId: string }) => p.callId)).toEqual(['s1', 's2']);
  });

  it('updates status, urgency and rank with reasons, recording events (QUE-03, PRI-06)', async () => {
    const { app, as, store } = await seeded();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/cases/watch',
      ...as('staff'),
      payload: { status: 'in_progress', urgency: 'urgent', scoreOffset: 2, reason: 'Daughter says she has not eaten for days' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'in_progress', staffUrgency: 'urgent', staffScoreOffset: 2 });
    const events = await store.listCaseEvents('watch');
    expect(events.map((e) => e.type)).toEqual(['urgency_changed', 'rank_changed', 'status_changed']);
    expect(events[0]).toMatchObject({ actorUid: 'staff-1', autoUrgency: 'watch', from: 'watch', to: 'urgent' });
  });

  it.each([
    ['empty update', {}],
    ['urgency without reason', { urgency: 'urgent' }],
    ['rank without reason', { scoreOffset: 3 }],
    ['close without outcome', { status: 'closed' }],
    ['invalid urgency', { urgency: 'critical', reason: 'x' }],
  ])('rejects %s', async (_l, payload) => {
    const { app, as } = await seeded();
    expect((await app.inject({ method: 'PATCH', url: '/api/cases/watch', ...as('staff'), payload })).statusCode).toBe(400);
  });

  it('closes with an outcome and 404s on unknown cases', async () => {
    const { app, as } = await seeded();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/cases/watch',
      ...as('staff'),
      payload: { status: 'closed', outcome: { anomalyConfirmed: false, note: 'Was fasting for a test' } },
    });
    expect(res.json()).toMatchObject({ status: 'closed', closedAt: NOW.toISOString(), outcome: { anomalyConfirmed: false } });
    const missing = await app.inject({ method: 'PATCH', url: '/api/cases/nope', ...as('staff'), payload: { status: 'in_progress' } });
    expect(missing.statusCode).toBe(404);
  });
});

describe('family dashboard (FAM-01..04)', () => {
  async function seeded() {
    const ctx = setup();
    await ctx.store.createResident(makeResident('res-1'));
    await ctx.store.createResident(makeResident('res-other', { family: { name: 'Zed', sms: '+819011111111' } }));
    await ctx.store.addCalls([
      call(),
      call({ id: 'missed', startedAt: '2026-09-30T01:00:00.000Z', status: 'no_answer', durationSec: undefined }),
      call({ id: 'live', startedAt: '2026-10-01T02:59:00.000Z', status: 'in_progress' }),
      call({ id: 'old', startedAt: '2026-09-10T01:00:00.000Z' }),
    ]);
    await ctx.store.putCase(
      storedCase({
        id: 'em',
        rule: 'R1',
        autoUrgency: 'emergency',
        status: 'in_progress',
        notifications: [
          { recipient: 'staff', channel: 'sms', address: '+81300000000', sentAt: '2026-10-01T01:06:00.000Z' },
          {
            recipient: 'family',
            channel: 'voice',
            address: '+819000000002',
            sentAt: '2026-10-01T01:06:02.000Z',
            delivery: { status: 'answered', at: '2026-10-01T01:07:00.000Z' },
          },
          {
            recipient: 'family',
            channel: 'sms',
            address: '+819000000002',
            sentAt: '2026-10-01T01:06:01.000Z',
            delivery: { status: 'undelivered', errorCode: '30007', at: '2026-10-01T01:06:30.000Z' },
          },
          { recipient: 'family', channel: 'email', address: 'alice@example.org', sentAt: '2026-10-01T01:06:01.000Z' },
        ],
      }),
    );
    await ctx.store.putCase(storedCase({ id: 'staff-only', notifications: [{ recipient: 'staff', channel: 'email', address: 's', sentAt: '2026-10-01T01:00:00.000Z' }] }));
    return ctx;
  }

  it('lists only residents linked to the verified phone or email', async () => {
    const { app, as } = await seeded();
    for (const who of ['familyPhone', 'familyEmail'] as const) {
      const res = await app.inject({ method: 'GET', url: '/api/family/residents', ...as(who) });
      expect(res.json().residents).toEqual([{ id: 'res-1', name: 'Margaret Smith' }]);
    }
    expect((await app.inject({ method: 'GET', url: '/api/family/residents', ...as('stranger') })).json().residents).toEqual([]);
  });

  it('shows 2 weeks of calls, the next call, alerts and staff contact without transcripts or analysis', async () => {
    const { app, as } = await seeded();
    const res = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyPhone') });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.resident).toEqual({ id: 'res-1', name: 'Margaret Smith' });
    expect(d.nextCallAt).toBe('2026-10-02T01:00:00.000Z');
    expect(d.calls).toEqual([
      { startedAt: '2026-10-01T01:00:00.000Z', connected: true, durationSec: 240, summary: { health: 'A little tired', meals: 'Ate very little yesterday', topics: ['grandson'] } },
      { startedAt: '2026-09-30T01:00:00.000Z', connected: false, durationSec: null, summary: null },
    ]);
    expect(d.alerts).toEqual([
      {
        sentAt: '2026-10-01T01:06:01.000Z',
        channels: ['voice', 'sms', 'email'],
        deliveries: [
          { channel: 'voice', status: 'answered', errorCode: null },
          { channel: 'sms', status: 'undelivered', errorCode: '30007' },
          { channel: 'email', status: null, errorCode: null },
        ],
        caseStatus: 'in_progress',
        caseStatusLabel: '対応中',
      },
    ]);
    expect(res.body).not.toContain('+819000000002');
    expect(res.body).not.toContain('alice@example.org');
    expect(d.staff).toEqual({ name: 'Tanaka', phone: '+81300000000', email: 'staff@example.org' });
    const body = res.body;
    for (const forbidden of ['transcript', 'audio', 'speech', 'I only had a biscuit', 'Only a biscuit yesterday', 'reason', 'score']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('returns the same 404 for missing residents and residents of other families', async () => {
    const { app, as } = await seeded();
    const other = await app.inject({ method: 'GET', url: '/api/family/residents/res-other/dashboard', ...as('familyPhone') });
    const missing = await app.inject({ method: 'GET', url: '/api/family/residents/nope/dashboard', ...as('familyPhone') });
    expect(other.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(other.body).toBe(missing.body);
  });

  it('shows no next call for paused residents and supports English labels', async () => {
    const { app, as, store } = await seeded();
    await store.updateResident('res-1', (r) => ({ ...r, active: false }));
    const d = (await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard?locale=en', ...as('familyEmail') })).json();
    expect(d.nextCallAt).toBeNull();
    expect(d.alerts[0].caseStatusLabel).toBe('In progress');
  });

  it('registers push tokens for emergency alerts', async () => {
    const { app, as, store } = await seeded();
    const res = await app.inject({ method: 'POST', url: '/api/family/push-tokens', ...as('familyPhone'), payload: { token: 'fcm-token-abcdef' } });
    expect(res.statusCode).toBe(204);
    expect((await store.getResident('res-1'))?.family?.pushTokens).toEqual(['fcm-token-abcdef']);
    expect((await store.getResident('res-other'))?.family?.pushTokens).toEqual([]);
    const bad = await app.inject({ method: 'POST', url: '/api/family/push-tokens', ...as('familyPhone'), payload: { token: 'x' } });
    expect(bad.statusCode).toBe(400);
  });
});
