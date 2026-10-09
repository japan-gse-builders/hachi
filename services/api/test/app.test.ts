import { charge, parseSpendSettings, spendMonth, USD } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CASE_CALLS } from '../src/views.js';
import { MemoryStore } from '@hachi/store';
import { call, detection, fakeSigner, FakeVerifier, makeResident, NOW, residentInput, said, setup, storedCase, wellbeing } from './helpers.js';

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
    expect(en.json().items[0].urgencyLabel).toBe('Immediate action');
  });

  it('carries what each level asks for, and the whole scale as a legend (QUE-01)', async () => {
    const { app, as } = await seeded();
    const body = (await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') })).json();
    expect(body.items[0].urgencyMeaning).toBe('Possible immediate danger to life or health. Act now.');
    // A card only ever shows its own level, so the queue carries the other three as well.
    expect(body.legend.map((l: { urgency: string }) => l.urgency)).toEqual(['emergency', 'urgent', 'action', 'watch']);
    expect(body.legend[3]).toEqual({ urgency: 'watch', label: 'Monitor', action: 'watch for now' });
    const ja = (await app.inject({ method: 'GET', url: '/api/queue', ...as('staff') })).json();
    expect(ja.legend[0].label).toBe('緊急');
    expect(ja.items[0].urgencyMeaning).toContain('いま動く');
  });

  it('names the case state rather than printing the stored value (QUE-01)', async () => {
    const { app, as, store } = await seeded();
    await store.putCase(storedCase({ id: 'watch', residentId: 'res-2', rule: 'R3', status: 'in_progress' }));
    const items = (await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') })).json().items;
    const working = items.find((i: { caseId: string }) => i.caseId === 'watch');
    expect(working).toMatchObject({ status: 'in_progress', statusLabel: 'In progress' });
    expect(items[0]).toMatchObject({ status: 'open', statusLabel: 'Not started' });
  });

  it('tells staff where the month stands, and says so plainly when calls have stopped', async () => {
    const spend = parseSpendSettings({ AI_MONTHLY_CAP_USD: '100' });
    const { app, as, store } = setup({ spend });
    const month = spendMonth(NOW);
    const quiet = await app.inject({ method: 'GET', url: '/api/spend?locale=en', ...as('staff') });
    expect(quiet.json()).toMatchObject({ month, paused: false, cap: '$100.00', committed: '$0.00', usedPercent: 0 });

    await store.mutateSpendLedger(month, (l) => charge(l, 95 * USD, NOW));
    const used = (await app.inject({ method: 'GET', url: '/api/spend?locale=en', ...as('staff') })).json();
    expect(used).toMatchObject({ paused: true, usedPercent: 95, remaining: '$0.00' });
    // The sentence has to say that an emergency still gets through, or staff will assume it does not.
    expect(used.note).toContain('Emergency contact is unaffected');
    const ja = (await app.inject({ method: 'GET', url: '/api/spend', ...as('staff') })).json();
    expect(ja.note).toContain('緊急時の連絡は止まりません');
  });

  it('keeps the month away from family and from anyone not signed in', async () => {
    const { app, as } = setup({ spend: parseSpendSettings({}) });
    expect((await app.inject({ method: 'GET', url: '/api/spend', ...as('familyPhone') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/spend', ...as(null) })).statusCode).toBe(401);
  });

  it('reports nothing rather than guessing when no budget is configured', async () => {
    const { app, as } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/spend', ...as('staff') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
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
    expect(d.resident.synthetic).toBe(false);
  });

  it('sends the update form its choices, so their names are not written twice (QUE-03)', async () => {
    const { app, as } = await seeded();
    const en = (await app.inject({ method: 'GET', url: '/api/cases/emergency?locale=en', ...as('staff') })).json();
    expect(en.case).toMatchObject({ statusLabel: 'Not started', urgencyMeaning: 'Possible immediate danger to life or health. Act now.' });
    expect(en.statusOptions).toEqual([
      { value: 'open', label: 'Not started' },
      { value: 'in_progress', label: 'In progress' },
      { value: 'closed', label: 'Done' },
    ]);
    expect(en.urgencyOptions.map((o: { value: string }) => o.value)).toEqual(['emergency', 'urgent', 'action', 'watch']);
    expect(en.urgencyOptions[1]).toEqual({ value: 'urgent', label: 'Review today', meaning: 'Needs checking today: contact the resident.' });
    const ja = (await app.inject({ method: 'GET', url: '/api/cases/emergency', ...as('staff') })).json();
    expect(ja.statusOptions[0].label).toBe('未対応');
    expect(ja.urgencyOptions[0].label).toBe('緊急');
  });

  it('marks a synthetic resident on the case so a demo quote is not read as a real one (USR-04)', async () => {
    const { app, as, store } = await seeded();
    await store.updateResident('res-1', (r) => ({ ...r, synthetic: true }));
    const d = (await app.inject({ method: 'GET', url: '/api/cases/emergency', ...as('staff') })).json();
    expect(d.resident.synthetic).toBe(true);
  });

  it('shows staff every tag with the turn, basis and confidence behind it', async () => {
    const { app, as, store } = await seeded();
    await store.updateCall('res-1', 'call-1', (c) => ({
      ...c,
      wellbeing: wellbeing(
        [
          { id: 'food.ate_little', turn: 1, basis: 'said', confidence: 0.9 },
          { id: 'speech.repeating', turn: 1, basis: 'inferred', confidence: 0.8 },
          { id: 'mood.lonely', turn: 7, basis: 'inferred', confidence: 0.8 },
        ],
        'Maggie had not eaten much.',
      ),
    }));
    await store.addCalls([call({ id: 'call-0', startedAt: '2026-09-30T01:00:00.000Z' })]);
    const d = (await app.inject({ method: 'GET', url: '/api/cases/emergency?locale=en', ...as('staff') })).json();
    const w = d.calls.find((c: { id: string }) => c.id === 'call-1').wellbeing;
    expect(w.headline).toBe('Maggie had not eaten much.');
    expect(w.domains).toMatchObject({ food: 'concern', speech: 'concern', mood: 'concern', sleep: 'unmentioned' });
    expect(w.tags).toEqual([
      { id: 'food.ate_little', label: 'Ate little', domain: 'food', polarity: 'concern', audience: 'family', turn: 1, basis: 'said', confidence: 0.9, quote: 'I only had a biscuit' },
      { id: 'speech.repeating', label: 'Repeating themselves', domain: 'speech', polarity: 'concern', audience: 'staff', turn: 1, basis: 'inferred', confidence: 0.8, quote: 'I only had a biscuit' },
      { id: 'mood.lonely', label: 'Lonely', domain: 'mood', polarity: 'concern', audience: 'family_with_consent', turn: 7, basis: 'inferred', confidence: 0.8, quote: null },
    ]);
    expect(d.calls.find((c: { id: string }) => c.id === 'call-0').wellbeing).toBeNull();
  });

  it('shows details for closed cases and returns 404 for unknown ones', async () => {
    const { app, as } = await seeded();
    expect((await app.inject({ method: 'GET', url: '/api/cases/closed', ...as('staff') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/cases/nope', ...as('staff') })).statusCode).toBe(404);
  });

  const spoken = (id: string, startedAt: string, usable = true, latency = 900, measuredFrom?: 'audio') =>
    call({
      id,
      startedAt,
      speech: {
        callId: id,
        at: startedAt,
        usable,
        exclusionReasons: usable ? [] : ['temporary_condition'],
        features: { lexicalDiversity: 0.7, repairRate: 1, responseLatencyMs: latency, topicCoherence: null },
        ...(measuredFrom ? { measuredFrom } : {}),
      },
    });

  it('includes the speech trend oldest first, marking calls left out of the analysis', async () => {
    const { app, as, store } = await seeded();
    await store.addCalls([
      spoken('s1', '2026-09-28T01:00:00.000Z'),
      spoken('s2', '2026-09-29T01:00:00.000Z', true, 900, 'audio'),
      spoken('s3', '2026-09-30T01:00:00.000Z', false),
    ]);
    const d = (await app.inject({ method: 'GET', url: '/api/cases/emergency', ...as('staff') })).json();
    expect(d.speechTrend.map((p: { callId: string }) => p.callId)).toEqual(['s1', 's2', 's3']);
    expect(d.speechTrend[0]).toMatchObject({ usable: true, exclusionReasons: [], measuredFrom: 'transcript' });
    expect(d.speechTrend[1].measuredFrom).toBe('audio');
    expect(d.speechTrend[2]).toMatchObject({ usable: false, exclusionReasons: ['temporary_condition'] });
    // The resident started on the day of the test calls: no usual range yet.
    expect(d.speechBaseline).toBeNull();
  });

  it("returns the resident's usual speech range per measuring method, from older calls than it lists", async () => {
    const { app, as, store } = await seeded();
    await store.updateResident('res-1', (r) => ({ ...r, serviceStartedAt: '2026-06-01T00:00:00.000Z' }));
    const day = (n: number) => new Date(Date.parse('2026-06-01T01:00:00.000Z') + n * 86_400_000).toISOString();
    // 8 baseline calls in June (transcript timings) then 70 later calls, so June falls off the listed calls.
    await store.addCalls([
      ...Array.from({ length: 8 }, (_, i) => spoken(`b${i}`, day(i * 3), true, 800 + (i % 2) * 200)),
      ...Array.from({ length: 70 }, (_, i) => spoken(`l${i}`, day(40 + i), true, 5000, 'audio')),
    ]);
    const d = (await app.inject({ method: 'GET', url: '/api/cases/emergency', ...as('staff') })).json();
    expect(d.calls).toHaveLength(CASE_CALLS);
    expect(d.speechTrend.some((p: { callId: string }) => p.callId.startsWith('b'))).toBe(false);
    expect(d.speechBaseline).toMatchObject({ from: '2026-06-01T00:00:00.000Z', callCount: 8 });
    const latency = d.speechBaseline.ranges.responseLatencyMs;
    expect(latency.audio).toBeUndefined();
    expect(latency.transcript.mean).toBeCloseTo(900);
    expect(latency.transcript.low).toBeLessThan(900);
    expect(latency.transcript.high).toBeGreaterThan(900);
    expect(d.speechBaseline.ranges.lexicalDiversity.audio).toEqual(d.speechBaseline.ranges.lexicalDiversity.transcript);
    expect(d.speechBaseline.ranges.topicCoherence).toBeUndefined();

    const family = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyPhone') });
    expect(family.statusCode).toBe(200);
    for (const forbidden of ['speech', 'Baseline', 'ranges', 'usable', 'exclusion']) expect(family.body).not.toContain(forbidden);
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

describe('residents nobody reached (QUE-01)', () => {
  /** Resident-local 2026-10-01, which is the day `NOW` falls on in Tokyo. */
  const TODAY = '2026-10-01';
  const attempt = (residentId: string, n: number, overrides: Partial<ReturnType<typeof call>> = {}) =>
    call({
      id: `${TODAY}-${n}`,
      residentId,
      localDate: TODAY,
      startedAt: `2026-10-01T0${n}:00:00.000Z`,
      status: 'failed',
      transcript: [],
      summary: undefined,
      ...overrides,
    });

  const unreached = async (url = '/api/queue') => {
    const ctx = setup();
    await ctx.store.createResident(makeResident('res-1'));
    await ctx.store.createResident(makeResident('res-2', { name: 'Bob Brown' }));
    return { ...ctx, get: async () => (await ctx.app.inject({ method: 'GET', url, ...ctx.as('staff') })).json().unreached };
  };

  it('reports a resident whose calls were never placed, with what to do about it', async () => {
    const ctx = await unreached();
    await ctx.store.addCalls([
      attempt('res-1', 1, { failure: { code: 'gateway_unavailable', message: 'not placed', retryable: false } }),
      attempt('res-1', 2, { failure: { code: 'gateway_unavailable', message: 'not placed', retryable: false } }),
    ]);
    const { items, note } = await ctx.get();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      residentId: 'res-1',
      residentName: 'Margaret Smith',
      localDate: TODAY,
      reason: 'service_fault',
      reasonLabel: 'システム障害',
      attempts: 2,
      ourFault: true,
      lastReachedAt: null,
    });
    expect(items[0].meaning).toContain('電話で確かめる');
    expect(items[0].tried).toContain('2 回かけました');
    expect(note).toContain('1 人');
  });

  it('localizes server-side, so the app never has to know these words', async () => {
    const ctx = await unreached('/api/queue?locale=en');
    await ctx.store.addCalls([attempt('res-1', 1, { failure: { code: 'gateway_unavailable', message: 'x', retryable: false } })]);
    const { items, note } = await ctx.get();
    expect(items[0]).toMatchObject({ reasonLabel: 'System fault' });
    expect(items[0].meaning).toContain('A fault on our side');
    expect(items[0].tried).toBe('Rang once. No call has connected in 14 days.');
    expect(note).toContain('the fault is ours');
  });

  it('says nothing about a resident who was reached, or whose call has not been tried yet', async () => {
    const ctx = await unreached();
    await ctx.store.addCalls([
      attempt('res-1', 1, { status: 'no_answer' }),
      attempt('res-1', 2, { status: 'completed', conversation: { endedBy: 'agent', at: NOW.toISOString() } }),
      attempt('res-2', 1, { status: 'scheduled' }),
    ]);
    expect(await ctx.get()).toEqual({ items: [], note: null });
  });

  it('keeps a gateway outage apart from a resident who did not pick up, and puts ours first', async () => {
    const ctx = await unreached();
    await ctx.store.addCalls([
      attempt('res-1', 1, { status: 'no_answer' }),
      attempt('res-2', 2, { failure: { code: 'gateway_unavailable', message: 'x', retryable: false } }),
    ]);
    const { items, note } = await ctx.get();
    // Ours first: it is the one where nothing at all is known about the resident.
    expect(items.map((i: { residentId: string }) => i.residentId)).toEqual(['res-2', 'res-1']);
    expect(items[1]).toMatchObject({ reason: 'no_answer', ourFault: false, reasonLabel: '応答なし' });
    expect(note).toContain('うち 1 人');
  });

  it('names the date they were last heard from when there is one', async () => {
    const ctx = await unreached();
    await ctx.store.addCalls([
      call({ id: 'older', residentId: 'res-1', localDate: '2026-09-28', startedAt: '2026-09-28T01:00:00.000Z' }),
      attempt('res-1', 1, { failure: { code: 'gateway_unavailable', message: 'x', retryable: false } }),
    ]);
    const items = (await ctx.get()).items;
    expect(items[0]).toMatchObject({ lastReachedAt: '2026-09-28T01:00:00.000Z' });
    expect(items[0].tried).toContain('2026-09-28');
  });

  it('leaves a paused resident out, because nobody is expecting a call', async () => {
    const ctx = await unreached();
    await ctx.store.updateResident('res-1', (r) => ({ ...r, active: false }));
    await ctx.store.addCalls([attempt('res-1', 1, { failure: { code: 'gateway_unavailable', message: 'x', retryable: false } })]);
    expect((await ctx.get()).items).toEqual([]);
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
      {
        startedAt: '2026-10-01T01:00:00.000Z',
        connected: true,
        durationSec: 240,
        summary: { health: 'A little tired', meals: 'Ate very little yesterday', topics: ['grandson'] },
        headline: 'Margaret Smithさんが通話中に話したことについて、Hachi がケアチームに連絡しました。ケアチームの対応：対応中。',
        domains: null,
        tags: [],
      },
      { startedAt: '2026-09-30T01:00:00.000Z', connected: false, durationSec: null, summary: null, headline: null, domains: null, tags: [] },
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

describe('family glance: wellbeing tags at a glance (FAM-02, FAM-03)', () => {
  const at = (date: string, time = '01:00') => `${date}T${time}:00.000Z`;
  const tagged = (id: string, date: string, ids: Parameters<typeof said>, extra: Parameters<typeof call>[0] = {}) =>
    call({ id, startedAt: at(date), localDate: date, wellbeing: wellbeing(said(...ids)), ...extra });

  async function seeded(overrides: Partial<ReturnType<typeof makeResident>> = {}) {
    const ctx = setup();
    await ctx.store.createResident({ ...makeResident('res-1'), ...overrides });
    const today = wellbeing(
      [
        ...said('food.ate_little', 'activity.stayed_in', 'body.feeling_well', 'practical.money_worry'),
        { id: 'mood.lonely', turn: 1, basis: 'inferred', confidence: 0.8 },
        { id: 'speech.slower', turn: 1, basis: 'inferred', confidence: 0.9 },
      ],
      'Maggie was in good spirits but has not eaten much today.',
    );
    await ctx.store.addCalls([
      call({ id: 'today', startedAt: at('2026-10-01'), localDate: '2026-10-01', wellbeing: today }),
      tagged('afternoon', '2026-09-30', ['food.ate_well'], { startedAt: at('2026-09-30', '05:00') }),
      tagged('morning', '2026-09-30', ['food.ate_little', 'activity.gardening']),
      call({ id: 'missed', startedAt: at('2026-09-29'), localDate: '2026-09-29', status: 'no_answer', wellbeing: wellbeing(said('food.cooked')) }),
      call({ id: 'before-tags', startedAt: at('2026-09-28'), localDate: '2026-09-28' }),
      ...['27', '26', '25', '24', '23', '22', '21', '20'].map((d) => tagged(`sep-${d}`, `2026-09-${d}`, ['activity.gardening', 'food.ate_well'])),
    ]);
    return ctx;
  }

  const dashboard = async (locale = 'en') => {
    const { app, as } = await seeded();
    const res = await app.inject({ method: 'GET', url: `/api/family/residents/res-1/dashboard?locale=${locale}`, ...as('familyPhone') });
    expect(res.statusCode).toBe(200);
    return { body: res.body, d: res.json() };
  };

  it("shows the latest call's headline and six life domains, mood as a state only", async () => {
    const { d } = await dashboard();
    expect(d.glance.shareMood).toBe(true);
    expect(d.glance.latest).toEqual({
      startedAt: at('2026-10-01'),
      headline: 'Maggie was in good spirits but has not eaten much today.',
      domains: { body: 'good', food: 'concern', sleep: 'unmentioned', mood: 'concern', social: 'unmentioned', activity: 'concern' },
    });
    expect(d.calls[0]).toMatchObject({
      headline: 'Maggie was in good spirits but has not eaten much today.',
      domains: d.glance.latest.domains,
      tags: [
        { id: 'food.ate_little', label: 'Ate little', domain: 'food', polarity: 'concern' },
        { id: 'activity.stayed_in', label: 'Stayed in all day', domain: 'activity', polarity: 'concern' },
        { id: 'body.feeling_well', label: 'Feeling well', domain: 'body', polarity: 'positive' },
      ],
    });
  });

  it.each([undefined, { shareMood: false, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' }])(
    'withholds mood and generated free text without sharing approval: %j', async (consent) => {
      const { app, as } = await seeded({ consent });
      const res = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard?locale=en', ...as('familyPhone') });
      expect(res.statusCode).toBe(200);
      const d = res.json();
      expect(d.glance.shareMood).toBe(false);
      expect(d.glance.latest).toMatchObject({ headline: null, domains: { mood: 'unmentioned', food: 'concern', body: 'good' } });
      expect(d.glance.days.every((day: { domains: { mood: string } | null }) => !day.domains || day.domains.mood === 'unmentioned')).toBe(true);
      expect(d.calls.every((c: { summary: unknown; headline: unknown; domains: { mood: string } | null }) =>
        c.summary === null && c.headline === null && (!c.domains || c.domains.mood === 'unmentioned'))).toBe(true);
      expect(res.body).not.toContain('good spirits');
      expect(d.calls[0].tags.map((t: { id: string }) => t.id)).toContain('food.ate_little');
      expect(d.staff.name).toBe('Tanaka');
    },
  );

  it('builds 14 resident-local days, merging calls on one day and marking days without a connected call', async () => {
    const { d } = await dashboard();
    const days = d.glance.days as { date: string; tagged: boolean; domains: Record<string, string> | null }[];
    expect(days).toHaveLength(14);
    expect(days[0]!.date).toBe('2026-09-18');
    expect(days.at(-1)!.date).toBe('2026-10-01');
    const day = (date: string) => days.find((x) => x.date === date)!;
    expect(day('2026-09-30')).toEqual({
      date: '2026-09-30',
      tagged: true,
      domains: { body: 'unmentioned', food: 'mixed', sleep: 'unmentioned', mood: 'unmentioned', social: 'unmentioned', activity: 'good' },
    });
    expect(day('2026-09-29')).toEqual({ date: '2026-09-29', tagged: false, domains: null });
    expect(day('2026-09-19').domains).toBeNull();
    // Analysed before tags existed: not talked about, never fine.
    expect(day('2026-09-28')).toEqual({
      date: '2026-09-28',
      tagged: false,
      domains: { body: 'unmentioned', food: 'unmentioned', sleep: 'unmentioned', mood: 'unmentioned', social: 'unmentioned', activity: 'unmentioned' },
    });
    expect(d.calls.find((c: { startedAt: string }) => c.startedAt === at('2026-09-28'))).toMatchObject({ domains: null, tags: [], headline: null });
  });

  it('counts family tags in the last 7 tagged calls against the 7 before', async () => {
    const { d } = await dashboard();
    expect(d.glance.trends.map((t: { id: string }) => t.id)).toEqual(['food.ate_well', 'activity.gardening', 'food.ate_little', 'activity.stayed_in', 'body.feeling_well']);
    expect(d.glance.trends[0]).toEqual({ id: 'food.ate_well', label: 'Ate well', domain: 'food', polarity: 'positive', last: 5, previous: 4, lastCalls: 7, previousCalls: 4, direction: 'less' });
    expect(d.glance.trends[2]).toMatchObject({ id: 'food.ate_little', last: 2, previous: 0, direction: 'more' });
  });

  it('never shows family the turns, basis, confidence, quotes, speech or consent-only tags', async () => {
    const { body } = await dashboard();
    for (const forbidden of ['turn', 'basis', 'confidence', 'inferred', 'quote', 'I only had a biscuit', 'speech', 'Slower', 'mood.', 'Lonely', 'practical', 'Scam', 'audience']) {
      expect(body).not.toContain(forbidden);
    }
    const ja = await dashboard('ja');
    expect(ja.d.calls[0].tags[0].label).toBe('食事が少ない');
    expect(ja.body).not.toContain('寂しい');
  });

  it("replaces the model's sentence on an emergency call with what the care team did", async () => {
    const ctx = await seeded({ consent: undefined });
    const r1 = detection({ rule: 'R1', urgency: 'emergency', evidence: [{ callId: 'today', quote: 'My chest hurts', startMs: 0, endMs: 1 }] });
    await ctx.store.putCase(storedCase({ id: 'r1', rule: 'R1', autoUrgency: 'emergency', status: 'in_progress', detections: [r1] }));
    const get = async (locale: string) =>
      (await ctx.app.inject({ method: 'GET', url: `/api/family/residents/res-1/dashboard?locale=${locale}`, ...ctx.as('familyPhone') })).json();
    const en = await get('en');
    const sentence = 'Hachi let the care team know about something Margaret Smith said in this call. Care team follow-up: In progress.';
    expect(en.glance.latest.headline).toBe(sentence);
    expect(en.calls[0].headline).toBe(sentence);
    expect(en.calls.slice(1).every((c: { headline: string | null }) => !c.headline?.includes('care team'))).toBe(true);
    expect((await get('ja')).glance.latest.headline).toBe('Margaret Smithさんが通話中に話したことについて、Hachi がケアチームに連絡しました。ケアチームの対応：対応中。');
  });

  it('has no latest call or trends before the first connected call', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await store.addCalls([call({ id: 'missed', status: 'no_answer' })]);
    const d = (await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyPhone') })).json();
    expect(d.glance.latest).toBeNull();
    expect(d.glance.trends).toEqual([]);
    expect(d.glance.days.every((x: { domains: unknown }) => x.domains === null)).toBe(true);
  });
});
